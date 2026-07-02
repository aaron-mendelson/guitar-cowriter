/* ============================================================
 * client.ts — pluggable Anthropic access.
 * "byo-key" mode calls the Claude API directly from the browser
 * (dangerouslyAllowBrowser). "gateway" mode POSTs to a proxy.
 * Every call forces structured output via a single tool with
 * tool_choice {type:"tool"} so the result always matches a schema.
 * ============================================================ */
import Anthropic from "@anthropic-ai/sdk";

export interface AiConfig {
  mode: "byo-key" | "gateway";
  apiKey?: string;
  gatewayUrl?: string;
  model: string;
}

export const MODELS: { id: string; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const STORAGE_KEY = "cowriter-ai-config";

/** Self-hosted builds (Docker image) set VITE_SELF_HOSTED and ship a
 * same-origin /cowrite backend holding the Claude subscription token —
 * default to it. The public GitHub Pages build defaults to byo-key. */
const DEFAULT_CONFIG: AiConfig = import.meta.env.VITE_SELF_HOSTED
  ? { mode: "gateway", gatewayUrl: "/cowrite", model: "claude-sonnet-4-6" }
  : { mode: "byo-key", model: "claude-sonnet-4-6" };

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function getAiConfig(): AiConfig {
  if (!hasStorage()) return { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setAiConfig(c: Partial<AiConfig>): void {
  const merged = { ...getAiConfig(), ...c };
  if (hasStorage()) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

/** True when the app can make live AI calls at all. */
export function hasKey(): boolean {
  const cfg = getAiConfig();
  if (cfg.mode === "gateway") return Boolean(cfg.gatewayUrl);
  return Boolean(cfg.apiKey);
}

export interface CallClaudeOpts {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  toolName: string;
  toolDescription: string;
  schema: object;
  maxTokens?: number;
}

/**
 * Call Claude with forced structured output. Returns the tool_use
 * input, which is guaranteed by the API to match `schema`.
 */
export async function callClaude(opts: CallClaudeOpts): Promise<any> {
  const cfg = getAiConfig();

  if (cfg.mode === "gateway") {
    return callGateway(cfg, opts);
  }

  if (!cfg.apiKey) {
    throw new Error("No API key configured — add one in Settings, or work offline.");
  }

  const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: opts.messages,
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.schema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
    });
  } catch (err) {
    throw toReadableError(err);
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Claude did not return structured output — try again.");
  }
  return toolUse.input;
}

/** Gateway stub: POST {system, messages, schema} as JSON; bearer = apiKey. */
async function callGateway(cfg: AiConfig, opts: CallClaudeOpts): Promise<any> {
  if (!cfg.gatewayUrl) {
    throw new Error("Gateway mode is selected but no gateway URL is configured.");
  }
  let res: Response;
  try {
    res = await fetch(cfg.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        system: opts.system,
        messages: opts.messages,
        schema: opts.schema,
        toolName: opts.toolName,
        toolDescription: opts.toolDescription,
        model: cfg.model,
        maxTokens: opts.maxTokens ?? 4096,
      }),
    });
  } catch {
    throw new Error("Could not reach the gateway — check your connection.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Invalid API key");
  if (res.status === 529 || res.status === 429) throw new Error("Claude is busy, try again");
  if (!res.ok) throw new Error(`Gateway error (${res.status}) — try again.`);
  return res.json();
}

/** Map SDK errors to short, readable messages. */
function toReadableError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error("Invalid API key");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error("Claude is busy, try again");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error("Could not reach Claude — check your connection.");
  }
  if (err instanceof Anthropic.APIError) {
    const status = (err as { status?: number }).status;
    if (status === 401) return new Error("Invalid API key");
    if (status === 529 || (status != null && status >= 500)) {
      return new Error("Claude is busy, try again");
    }
    return new Error(`Claude request failed (${status ?? "unknown"}): ${err.message}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
