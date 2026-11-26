import { ANTHROPIC_API_VERSION, anthropicMessagesEndpoint } from "../shared/provider-protocol";
import {
  anthropicThinkingLevels,
  anthropicThinkingStyle,
  thinkingTokenBudget,
  type ThinkingLevel
} from "../shared/thinking";
import type { StoredSettings } from "./settings";

type FetchLike = typeof fetch;

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

const ANTHROPIC_VERSION = ANTHROPIC_API_VERSION;
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4_200;

function anthropicOutputLimit(model: string): number | undefined {
  const id = model.trim().toLowerCase();
  if (/^claude-3-5-/.test(id)) return 8_192;
  if (/^claude-3-(?:opus|sonnet|haiku)/.test(id)) return 4_096;
  return undefined;
}

/**
 * Native Claude transport. The Messages API is not OpenAI chat-completions:
 * system text is a separate field, thinking may be adaptive or budgeted, and
 * the answer arrives as content blocks.
 */
export async function callAnthropic(
  settings: StoredSettings,
  messages: ChatMessage[],
  options: CallOptions = {},
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const style = anthropicThinkingStyle(settings.model);
  const level: ThinkingLevel = settings.reasoningEffort;
  const thinkingEnabled = style !== "none" && level !== "default" && level !== "off";
  const canDisableThinking = anthropicThinkingLevels(settings.model).includes("off");
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: "user" as const, content: message.content }));
  if (conversation.length === 0) throw new Error("Claude needs at least one user message.");

  let maxTokens = options.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: conversation,
    max_tokens: maxTokens
  };
  if (system) body.system = system;

  if (style === "adaptive") {
    if (level !== "default" && (level !== "off" || canDisableThinking)) {
      body.thinking = { type: level === "off" ? "disabled" : "adaptive" };
    }
    if (thinkingEnabled) {
      body.output_config = { effort: level };
      maxTokens = Math.max(maxTokens, level === "max" ? 32_768 : level === "high" ? 16_384 : 8_192);
    }
  } else if (style === "budget") {
    if (level !== "default") {
      if (level === "off") {
        if (canDisableThinking) body.thinking = { type: "disabled" };
      } else {
        const budget = thinkingTokenBudget(level);
        body.thinking = { type: "enabled", budget_tokens: budget };
        maxTokens = Math.max(maxTokens, budget + 4_096);
      }
    }
  }

  if (style === "none") {
    body.temperature = options.temperature ?? settings.temperature;
  } else if (level !== "off") {
    maxTokens = Math.max(maxTokens, 8_192);
  }

  const outputLimit = anthropicOutputLimit(settings.model);
  if (outputLimit) maxTokens = Math.min(maxTokens, outputLimit);
  body.max_tokens = maxTokens;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), style !== "none" && level !== "off" ? 240_000 : 150_000);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let response: Response;
  try {
    response = await fetchImpl(anthropicMessagesEndpoint(settings.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (options.signal?.aborted) throw new Error("The Claude request was cancelled.");
    if (controller.signal.aborted) {
      throw new Error("Claude did not answer before the request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Claude request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = (await response.json()) as {
    content?: { type?: string; text?: string; thinking?: string }[];
    stop_reason?: string;
  };
  if (payload.stop_reason === "max_tokens") {
    throw new Error("Claude reached its output limit before finishing. Lower the thinking effort or raise the token budget.");
  }
  const blocks = payload.content ?? [];
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  if (text) return text;
  if (blocks.some((block) => block.type === "thinking" || block.thinking)) {
    throw new Error(
      "Claude returned only hidden reasoning and no final answer. Lower the thinking effort or choose a different Claude model."
    );
  }
  throw new Error("Claude returned no text.");
}
