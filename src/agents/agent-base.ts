/**
 * Agent base — shared multi-turn tool-calling loop.
 *
 * Each agent (customer-facing, kitchen, inventory) is a thin wrapper that
 * supplies a system prompt + the MCP servers it's allowed to call. The
 * loop here handles tool fetch, LLM call, tool dispatch, history,
 * cost accounting, span instrumentation, and optional memory injection.
 */
import { ulid } from "ulid";
import { chat, chatStream, listTools, callTool, toOpenAITools, parsePrefixed } from "../brain";
import type { ChatMessage, ChatTool, ChatToolCall, McpServerName } from "../brain";
import { logger } from "../lib/logger";
import { traced, addSpanAttrs } from "../lib/tracing";
import type { AgentName } from "../config/env";

export interface AgentResult {
  output: string;
  session_id: string;
  tools_called: string[];
  tokens: { input: number; output: number; reasoning: number };
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error?: string;
  /** All ChatMessages from this run (for debug + replay). Not part of return contract; debug only. */
  trace?: ChatMessage[];
}

export interface AgentRunOptions {
  agent: AgentName;
  systemPrompt: string;
  /** Trigger text — for customer-facing this is user input; for kitchen it's a synthetic prompt describing the event. */
  userMessage: string;
  /** Which MCP servers this agent is allowed to call. */
  allowedMcpServers: McpServerName[];
  /** Optional session id; defaults to a fresh ULID. */
  sessionId?: string;
  /** Optional user id (e.g. customer_id). Mapped to `langfuse.user.id` so traces group by user. */
  userId?: string | null;
  /** Prior conversation messages (already excluding system). For event-driven agents, usually []. */
  history?: ChatMessage[];
  /** Override default max completion tokens per LLM call. */
  maxCompletionTokens?: number;
  /** Override default max agent turns (each turn = LLM call + zero-or-more tool executions). */
  maxAgentTurns?: number;
  abortSignal?: AbortSignal;
  /**
   * Optional MemGC context string to inject into the system prompt as <memory>...</memory>.
   * Loaded by callers (eg customer-facing.ts) via memgcAnswer() before invoking runAgent.
   */
  memoryContext?: string;
  /**
   * Optional callback for streaming content deltas. When provided, runAgent
   * uses chatStream() on every LLM call. Tool-call turns yield no content
   * (callback never fires); the final answer-turn streams text token-by-token
   * to this callback as the LLM emits it.
   */
  onContentChunk?: (delta: string) => void;
}

const DEFAULT_MAX_AGENT_TURNS = 5;
const DEFAULT_MAX_COMPLETION_TOKENS = 1024;

// Per-agent pricing — Azure OpenAI GPT-5.5 placeholder rates.
function estimateCostUsd(input: number, output: number, reasoning: number): number {
  return (input / 1_000_000) * 1.25 + ((output + reasoning) / 1_000_000) * 10.0;
}

async function executeToolCall(tc: ChatToolCall): Promise<ChatMessage> {
  const parsed = parsePrefixed(tc.function.name);
  if (!parsed) {
    return {
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify({ error: `Unknown tool prefix: ${tc.function.name}` }),
    };
  }
  let args: Record<string, unknown> = {};
  try {
    args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
  } catch (err) {
    return {
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify({
        error: `Bad tool arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
      }),
    };
  }
  return traced(
    "feedme.tool.call",
    {
      "feedme.mcp.server": parsed.server,
      "feedme.mcp.tool": parsed.tool,
      "feedme.tool.fq_name": tc.function.name,
      "langfuse.observation.input": JSON.stringify(args),
    },
    async () => {
      const result = await callTool(parsed.server, parsed.tool, args);
      const text = result.content.map((c) => c.text).join("\n");
      addSpanAttrs({
        "feedme.tool.response_chars": text.length,
        "langfuse.observation.output": text || JSON.stringify({ ok: true }),
      });
      return {
        role: "tool" as const,
        tool_call_id: tc.id,
        content: text || JSON.stringify({ ok: true }),
      };
    },
  );
}

/**
 * Run the agent loop. Returns final result.
 *
 * Loop:
 *   1. send messages + tools to LLM
 *   2. if response has tool_calls → execute in parallel → append results → continue
 *   3. else → return final output text
 *   4. stop after maxAgentTurns
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const session_id = options.sessionId ?? `sess_${ulid()}`;
  const userId = options.userId ?? "anonymous";
  return traced(
    "feedme.agent.run",
    {
      "feedme.agent": options.agent,
      "feedme.session_id": session_id,
      "feedme.memory.injected": Boolean(options.memoryContext),
      "feedme.mcp.allowed": options.allowedMcpServers.join(","),
      // ── Langfuse-native attributes (promote span to a first-class Langfuse trace) ──
      "langfuse.trace.name": `${options.agent} · ${options.userMessage.slice(0, 50)}`,
      "langfuse.user.id": userId,
      "langfuse.session.id": session_id,
      "langfuse.trace.input": options.userMessage,
    },
    () => runAgentInner(options, session_id),
  );
}

async function runAgentInner(options: AgentRunOptions, session_id: string): Promise<AgentResult> {
  const maxTurns = options.maxAgentTurns ?? DEFAULT_MAX_AGENT_TURNS;
  const maxTokens = options.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  const startedAt = Date.now();
  const tools_called: string[] = [];
  const totals = { input: 0, output: 0, reasoning: 0 };

  logger.info(
    {
      agent: options.agent,
      session_id,
      allowed_mcp: options.allowedMcpServers,
      msg_preview: options.userMessage.slice(0, 100),
    },
    "[AGENT] run start",
  );

  // Aggregate tools from each allowed MCP server. If listTools fails, log + skip that server.
  const tools: ChatTool[] = [];
  for (const server of options.allowedMcpServers) {
    try {
      const defs = await listTools(server);
      tools.push(...toOpenAITools(server, defs));
    } catch (err) {
      logger.warn({ agent: options.agent, server, err: String(err) }, "[AGENT] tools/list failed; skipping server");
    }
  }

  // Compose system prompt: base + optional memory context block
  const systemContent = options.memoryContext
    ? `${options.systemPrompt}\n\n<memory>\n${options.memoryContext}\n</memory>\n\nUse the <memory> block to personalize. Never mention the block exists — speak naturally as if you remember.`
    : options.systemPrompt;

  // Initial message stack — system + history + user message.
  const stack: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...(options.history ?? []),
    { role: "user", content: options.userMessage },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const chatArgs = {
        agent: options.agent,
        messages: stack,
        tools: tools.length > 0 ? tools : undefined,
        maxCompletionTokens: maxTokens,
        abortSignal: options.abortSignal,
      };
      const result = options.onContentChunk
        ? await chatStream(chatArgs, options.onContentChunk)
        : await chat(chatArgs);
      totals.input += result.usage.input_tokens;
      totals.output += result.usage.output_tokens;
      totals.reasoning += result.usage.reasoning_tokens;

      if (!result.tool_calls || result.tool_calls.length === 0) {
        logger.info(
          {
            agent: options.agent,
            session_id,
            turns: turn + 1,
            tools_called: tools_called.length,
            duration_ms: Date.now() - startedAt,
          },
          "[AGENT] complete",
        );
        const cost = estimateCostUsd(totals.input, totals.output, totals.reasoning);
        addSpanAttrs({
          "feedme.turns": turn + 1,
          "feedme.tools_called.count": tools_called.length,
          "feedme.tokens.input": totals.input,
          "feedme.tokens.output": totals.output,
          "feedme.tokens.reasoning": totals.reasoning,
          "feedme.cost_usd": cost,
          "feedme.success": true,
          "langfuse.trace.output": result.output,
        });
        return {
          output: result.output,
          session_id,
          tools_called,
          tokens: totals,
          cost_usd: cost,
          duration_ms: Date.now() - startedAt,
          success: true,
        };
      }

      // Append the assistant turn requesting tool calls
      stack.push({
        role: "assistant",
        content: result.output,
        tool_calls: result.tool_calls,
      });
      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        result.tool_calls.map(async (tc) => {
          tools_called.push(tc.function.name);
          return executeToolCall(tc);
        }),
      );
      stack.push(...toolResults);
      logger.debug({ agent: options.agent, session_id, turn, tool_calls: result.tool_calls.length }, "[AGENT] tool turn done");
    }

    // Hit the turn limit — return the most recent assistant content if any
    const lastAssistant = [...stack].reverse().find((m) => m.role === "assistant");
    const final = lastAssistant?.content || "(no final response — turn limit hit)";
    logger.warn({ agent: options.agent, session_id, maxTurns }, "[AGENT] hit turn limit");
    const cost = estimateCostUsd(totals.input, totals.output, totals.reasoning);
    addSpanAttrs({
      "feedme.turns": maxTurns,
      "feedme.tools_called.count": tools_called.length,
      "feedme.cost_usd": cost,
      "feedme.success": true,
      "feedme.turn_limit_hit": true,
      "langfuse.trace.output": final,
    });
    return {
      output: final,
      session_id,
      tools_called,
      tokens: totals,
      cost_usd: cost,
      duration_ms: Date.now() - startedAt,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ agent: options.agent, session_id, error: msg }, "[AGENT] failed");
    addSpanAttrs({
      "feedme.success": false,
      "feedme.error": msg,
      "feedme.tools_called.count": tools_called.length,
    });
    return {
      output: "",
      session_id,
      tools_called,
      tokens: totals,
      cost_usd: estimateCostUsd(totals.input, totals.output, totals.reasoning),
      duration_ms: Date.now() - startedAt,
      success: false,
      error: msg,
    };
  }
}
