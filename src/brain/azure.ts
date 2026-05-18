/**
 * LLM brain — DeepSeek primary, Azure GPT-5.5 fallback.
 *
 * Both providers expose the OpenAI Chat Completions API shape, so the call
 * site is unchanged. We try DeepSeek first; on any error (network, 4xx, 5xx,
 * timeout) we automatically retry with Azure using the same messages/tools.
 *
 * Provider-specific quirks are isolated to the request builders:
 *  - DeepSeek: standard openai-style request, `deepseek-v4-flash` model
 *  - Azure GPT-5.5: max_completion_tokens (not max_tokens), no temperature,
 *    optional reasoning_effort
 */
import OpenAI, { AzureOpenAI } from "openai";
import { env, type AgentName, agentConfig } from "../config/env";
import { logger } from "../lib/logger";

const azureClient = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: env.AZURE_OPENAI_API_VERSION,
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
});

// DeepSeek uses the OpenAI SDK with a custom baseURL.
const deepseekClient = env.DEEPSEEK_API_KEY
  ? new OpenAI({
      baseURL: env.DEEPSEEK_BASE_URL,
      apiKey: env.DEEPSEEK_API_KEY,
      // Cap retries — we'll handle fallback to Azure ourselves rather than
      // letting the SDK silently double the latency on transient errors.
      maxRetries: 1,
      timeout: 30_000,
    })
  : null;

function deepseekAvailable(): boolean {
  return deepseekClient !== null;
}

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

/**
 * Streaming variant of chat(). Invokes `onContentChunk(delta)` for each text
 * delta as it arrives. Tool calls stream in as fragments — accumulated by
 * function index and only surfaced in the returned ChatResult at the end
 * (the loop in runAgent only needs the final assembled tool_calls).
 *
 * Returns the same shape as chat() once the stream completes.
 */
async function runChatStream(
  provider: "deepseek" | "azure",
  options: ChatOptions,
  onContentChunk: (delta: string) => void,
): Promise<ChatResult> {
  const cfg = agentConfig(options.agent);
  const start = Date.now();
  const model = provider === "deepseek" ? env.DEEPSEEK_MODEL : cfg.model;

  const requestBody = provider === "deepseek"
    ? {
        model,
        messages: options.messages,
        max_tokens: options.maxCompletionTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
        // Explicitly disable DeepSeek's "thinking" / reasoning step — we want
        // a direct answer with no hidden reasoning latency for the demo.
        thinking: { type: "disabled" },
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
          : {}),
      }
    : {
        model,
        messages: options.messages,
        max_completion_tokens: options.maxCompletionTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
          : {}),
        ...(cfg.reasoning !== "none" ? { reasoning_effort: cfg.reasoning } : {}),
      };

  const activeClient = provider === "deepseek" ? deepseekClient! : azureClient;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = (await activeClient.chat.completions.create(requestBody as any, {
    signal: options.abortSignal,
  })) as unknown as AsyncIterable<{
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  }>;

  let content = "";
  const toolCallsByIndex = new Map<number, { id: string; name: string; args: string }>();
  let finish_reason = "unknown";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? {};
    if (delta.content) {
      content += delta.content;
      onContentChunk(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCallsByIndex.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        toolCallsByIndex.set(idx, existing);
      }
    }
    if (choice?.finish_reason) finish_reason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }

  const tool_calls: ChatToolCall[] = [...toolCallsByIndex.values()].map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: tc.args },
  }));

  const duration = Date.now() - start;
  logger.info(
    {
      provider,
      agent: options.agent,
      model,
      duration_ms: duration,
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      tool_calls: tool_calls.length,
      finish_reason,
      streamed: true,
      output_preview: content.slice(0, 100),
    },
    `[BRAIN] ${provider} stream done`,
  );

  return {
    output: content,
    tool_calls,
    finish_reason,
    model,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
    duration_ms: duration,
  };
}

/** Public streaming chat entry — tries DeepSeek first, falls back to Azure. */
export async function chatStream(
  options: ChatOptions,
  onContentChunk: (delta: string) => void,
): Promise<ChatResult> {
  if (deepseekAvailable()) {
    try {
      return await runChatStream("deepseek", options, onContentChunk);
    } catch (err) {
      logger.warn(
        { agent: options.agent, err: err instanceof Error ? err.message : String(err) },
        "[BRAIN] DeepSeek stream failed — falling back to Azure GPT-5.5",
      );
    }
  }
  return runChatStream("azure", options, onContentChunk);
}

async function runChat(provider: "deepseek" | "azure", options: ChatOptions): Promise<ChatResult> {
  const cfg = agentConfig(options.agent);
  const start = Date.now();
  const model = provider === "deepseek" ? env.DEEPSEEK_MODEL : cfg.model;

  const requestBody = provider === "deepseek"
    ? {
        model,
        messages: options.messages,
        max_tokens: options.maxCompletionTokens ?? 2048,
        // Hard-disable DeepSeek's thinking step — same direct-answer goal
        // as setting reasoning_effort=none on GPT-5.5.
        thinking: { type: "disabled" },
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
          : {}),
      }
    : {
        model,
        messages: options.messages,
        max_completion_tokens: options.maxCompletionTokens ?? 2048,
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
          : {}),
        ...(cfg.reasoning !== "none" ? { reasoning_effort: cfg.reasoning } : {}),
      };

  const activeClient = provider === "deepseek" ? deepseekClient! : azureClient;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = (await activeClient.chat.completions.create(requestBody as any, {
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
      provider,
      agent: options.agent,
      model,
      duration_ms: duration,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      tool_calls: tool_calls.length,
      finish_reason: choice?.finish_reason,
      output_preview: output.slice(0, 100),
    },
    `[BRAIN] ${provider} done`,
  );

  return {
    output,
    tool_calls,
    finish_reason: choice?.finish_reason ?? "unknown",
    model,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, reasoning_tokens: reasoningTokens, total_tokens: totalTokens },
    duration_ms: duration,
  };
}

/** Public non-streaming chat entry — DeepSeek first, Azure fallback. */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  if (deepseekAvailable()) {
    try {
      return await runChat("deepseek", options);
    } catch (err) {
      logger.warn(
        { agent: options.agent, err: err instanceof Error ? err.message : String(err) },
        "[BRAIN] DeepSeek failed — falling back to Azure GPT-5.5",
      );
    }
  }
  return runChat("azure", options);
}
