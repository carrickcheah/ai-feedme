/**
 * Agent base — shared multi-turn tool-calling loop.
 *
 * Each agent (customer-facing, kitchen, inventory) is a thin wrapper that:
 *  - Provides its system prompt + which MCP servers it can call
 *  - Optionally provides per-turn pre/post hooks (memory fetch, audit logging)
 *
 * The loop here handles: tool fetch, LLM call, tool dispatch, history,
 * cost accounting, error recovery.
 *
 * Phase 2 Stage B: extracted from customer-facing.ts.
 * Phase 3 will add memory hooks (MemGC) + skills loading.
 */
import { ulid } from "ulid";
import { chat, listTools, callTool, toOpenAITools, parsePrefixed } from "../brain";
import type { ChatMessage, ChatTool, ChatToolCall, McpServerName } from "../brain";
import { logger } from "../lib/logger";
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
  /** Prior conversation messages (already excluding system). For event-driven agents, usually []. */
  history?: ChatMessage[];
  /** Override default max completion tokens per LLM call. */
  maxCompletionTokens?: number;
  /** Override default max agent turns (each turn = LLM call + zero-or-more tool executions). */
  maxAgentTurns?: number;
  abortSignal?: AbortSignal;
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
  const result = await callTool(parsed.server, parsed.tool, args);
  const text = result.content.map((c) => c.text).join("\n");
  return {
    role: "tool",
    tool_call_id: tc.id,
    content: text || JSON.stringify({ ok: true }),
  };
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

  // Initial message stack — system + history + user message.
  const stack: ChatMessage[] = [
    { role: "system", content: options.systemPrompt },
    ...(options.history ?? []),
    { role: "user", content: options.userMessage },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await chat({
        agent: options.agent,
        messages: stack,
        tools: tools.length > 0 ? tools : undefined,
        maxCompletionTokens: maxTokens,
        abortSignal: options.abortSignal,
      });
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
        return {
          output: result.output,
          session_id,
          tools_called,
          tokens: totals,
          cost_usd: estimateCostUsd(totals.input, totals.output, totals.reasoning),
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
    return {
      output: final,
      session_id,
      tools_called,
      tokens: totals,
      cost_usd: estimateCostUsd(totals.input, totals.output, totals.reasoning),
      duration_ms: Date.now() - startedAt,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ agent: options.agent, session_id, error: msg }, "[AGENT] failed");
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
