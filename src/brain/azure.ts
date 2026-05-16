/**
 * Azure OpenAI GPT-5.5 client.
 *
 * Phase 1 Day 2: sync chat with tools support.
 * Phase 1+ adds streaming.
 *
 * Reference: /Users/carrickcheah/Project/root_ai/z_API/API/AZURE_5-5.md
 *
 * GPT-5.5 quirks handled here:
 *  - `max_completion_tokens` not `max_tokens`
 *  - No custom temperature (always 1.0)
 *  - Supports `reasoning_effort` ("low" | "medium" | "high")
 *  - `tools` (functions) per the OpenAI spec
 */
import { AzureOpenAI } from "openai";
import { env, type AgentName, agentConfig } from "../config/env";
import { logger } from "../lib/logger";

const client = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: env.AZURE_OPENAI_API_VERSION,
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
});

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // For assistant messages that requested tool calls:
  tool_calls?: ChatToolCall[];
  // For tool messages that respond to a tool call:
  tool_call_id?: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded args from the LLM
  };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  output: string; // text content (may be empty if only tool_calls)
  tool_calls: ChatToolCall[];
  finish_reason: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
  };
  duration_ms: number;
}

export interface ChatOptions {
  agent: AgentName;
  messages: ChatMessage[]; // full message stack including system, history, user, tools
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | "required";
  maxCompletionTokens?: number;
  abortSignal?: AbortSignal;
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const cfg = agentConfig(options.agent);
  const start = Date.now();

  logger.debug(
    {
      agent: options.agent,
      model: cfg.model,
      reasoning: cfg.reasoning,
      messages: options.messages.length,
      tools: options.tools?.length ?? 0,
    },
    "[BRAIN] Azure GPT-5.5 call",
  );

  // GPT-5.5 quirks: max_completion_tokens, no temperature.
  // The `openai` SDK types don't include reasoning_effort, so we use a permissive cast.
  const requestBody = {
    model: cfg.model,
    messages: options.messages,
    max_completion_tokens: options.maxCompletionTokens ?? 2048,
    ...(options.tools && options.tools.length > 0
      ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
      : {}),
    ...(cfg.reasoning !== "none" ? { reasoning_effort: cfg.reasoning } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = (await client.chat.completions.create(requestBody as any, {
    signal: options.abortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;

  const duration = Date.now() - start;
  const choice = completion.choices?.[0];
  const message = choice?.message ?? {};
  const content = (message.content ?? "") as string;
  const reasoning = (message.reasoning_content ?? "") as string;
  const output = content || reasoning || "";
  const tool_calls: ChatToolCall[] = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((tc: { id: string; type: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
    : [];

  const usage = completion.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? 0;

  logger.info(
    {
      agent: options.agent,
      model: cfg.model,
      duration_ms: duration,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      tool_calls: tool_calls.length,
      finish_reason: choice?.finish_reason,
      output_preview: output.slice(0, 100),
    },
    "[BRAIN] Azure GPT-5.5 done",
  );

  return {
    output,
    tool_calls,
    finish_reason: choice?.finish_reason ?? "unknown",
    model: cfg.model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: totalTokens,
    },
    duration_ms: duration,
  };
}
