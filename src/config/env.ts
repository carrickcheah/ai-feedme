/**
 * Environment configuration — single source of truth.
 *
 * Reads from process.env (Bun loads .env automatically).
 * All access goes through `env.*` — never `process.env.X` elsewhere.
 */
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8002),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // ── Azure OpenAI GPT-5.5 ──
  AZURE_OPENAI_API_KEY: z.string().min(1, "AZURE_OPENAI_API_KEY required — see z_API/API/AZURE_5-5.md"),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_DEPLOYMENT: z.string().default("gpt-5.5"),
  AZURE_OPENAI_API_VERSION: z.string().default("2025-04-01-preview"),
  AZURE_OPENAI_MODEL: z.string().default("gpt-5.5"),

  // Per-agent reasoning_effort
  AZURE_REASONING_CUSTOMER_FACING: z.enum(["none", "low", "medium", "high"]).default("none"),
  AZURE_REASONING_KITCHEN: z.enum(["none", "low", "medium", "high"]).default("none"),
  AZURE_REASONING_INVENTORY: z.enum(["none", "low", "medium", "high"]).default("none"),

  // ── DeepSeek (primary LLM; falls back to Azure GPT-5.5 on any error) ──
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),

  // ── Infra ──
  REDIS_URL: z.string().default("redis://localhost:6379"),
  KAFKA_BROKERS: z.string().default("localhost:9094"),
  MEMGC_URL: z.string().url().default("http://localhost:8003"),

  // ── Kafka topics ──
  KAFKA_TOPIC_ORDER_CREATED: z.string().default("order.created"),
  KAFKA_TOPIC_ORDER_UPDATED: z.string().default("order.updated"),
  KAFKA_TOPIC_INGREDIENT_CONSUMED: z.string().default("ingredient.consumed"),
  KAFKA_TOPIC_STOCK_LOW: z.string().default("stock.low"),
  KAFKA_TOPIC_TICKET_READY: z.string().default("ticket.ready"),

  // ── MCP servers ──
  MCP_POS_URL: z.string().default("http://localhost:4001/mcp"),
  MCP_KITCHEN_DISPLAY_URL: z.string().default("http://localhost:4002/mcp"),
  MCP_PAYMENT_URL: z.string().default("http://localhost:4003/mcp"),
  MCP_SUPPLIER_URL: z.string().default("http://localhost:4004/mcp"),

  // ── Data ──
  DATA_DIR: z.string().default("./data"),

  // ── Restaurant ──
  RESTAURANT_NAME: z.string().default("IceYoo Desaru"),
  RESTAURANT_TIMEZONE: z.string().default("Asia/Kuala_Lumpur"),
  RESTAURANT_CURRENCY: z.string().default("MYR"),
  RESTAURANT_CURRENCY_SYMBOL: z.string().default("RM"),
  SST_PERCENT: z.coerce.number().default(0),

  // ── Frontend ──
  FRONTEND_DIR: z.string().default("./snow-dessert"),
  CORS_ALLOWED_ORIGINS: z.string().default("*"),

  // ── Observability ──
  // Note: z.coerce.boolean() turns "false" into true (string is truthy).
  // Use a string→boolean transform instead so .env="false" works as expected.
  LANGFUSE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true" || v === "1"),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default("https://us.cloud.langfuse.com"),

  // ── Internal auth ──
  INTERNAL_SERVICE_SECRET: z.string().default("dev-secret"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

// Per-agent resolver
export type AgentName = "customer-facing" | "kitchen" | "inventory";

export function agentConfig(agent: AgentName): {
  model: string;
  reasoning: "none" | "low" | "medium" | "high";
} {
  // GPT-5.5: same model for all agents. Knob is `reasoning_effort`.
  switch (agent) {
    case "customer-facing":
      return { model: env.AZURE_OPENAI_MODEL, reasoning: env.AZURE_REASONING_CUSTOMER_FACING };
    case "kitchen":
      return { model: env.AZURE_OPENAI_MODEL, reasoning: env.AZURE_REASONING_KITCHEN };
    case "inventory":
      return { model: env.AZURE_OPENAI_MODEL, reasoning: env.AZURE_REASONING_INVENTORY };
  }
}
