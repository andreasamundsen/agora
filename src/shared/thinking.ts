/*
 * Thinking controls are a presentation-level abstraction. Each provider
 * accepts a different parameter shape, so the app owns the mapping and shows
 * only the levels that the selected model can actually use.
 */

export type ThinkingLevel = "default" | "off" | "low" | "medium" | "high" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = ["default", "off", "low", "medium", "high", "max"];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === "default" ||
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "max"
  );
}

export interface ThinkingCapability {
  supported: boolean;
  levels: ThinkingLevel[];
  note: string;
}

const DEEPSEEK_THINKING_MODELS = new Set([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-reasoner"
]);

const OPENAI_REASONING_MODEL = /^(o[1-9]|gpt-5|gpt-6)/i;
const XAI_REASONING_MODEL = /^grok-/i;

/**
 * The model list is authoritative only for identifiers. These small, explicit
 * capability rules decide whether Agora can offer a thinking control safely.
 * Unknown models stay on the old request shape rather than receiving an
 * invented parameter.
 */
export function thinkingCapability(provider: string, model: string): ThinkingCapability {
  const id = model.trim().toLowerCase();

  if (provider === "deepseek" && DEEPSEEK_THINKING_MODELS.has(id)) {
    return {
      supported: true,
      levels: ["default", "off", "low", "high", "max"],
      note: "DeepSeek thinking uses a token budget. Medium is not exposed by this model; higher levels take longer and cost more."
    };
  }

  if (provider === "openai" && OPENAI_REASONING_MODEL.test(id)) {
    return {
      supported: true,
      levels: ["default", "low", "medium", "high"],
      note: "OpenAI reasoning models expose low, medium, and high effort. Max is not exposed on this chat-completions path."
    };
  }

  if (provider === "xai" && XAI_REASONING_MODEL.test(id)) {
    return {
      supported: true,
      levels: ["default", "low", "medium", "high", "max"],
      note: "Max is sent to xAI as its highest supported reasoning effort. The provider may ignore effort on non-reasoning models."
    };
  }

  if (provider === "local") {
    return {
      supported: false,
      levels: [],
      note: "Local only does not call a model, so there is no thinking setting."
    };
  }

  if (provider === "custom") {
    return {
      supported: false,
      levels: [],
      note: "Custom endpoints are not given thinking controls because Agora cannot verify their parameter support. Use the endpoint's default behavior."
    };
  }

  return {
    supported: false,
    levels: [],
    note: "This model does not expose an adjustable thinking level. Agora will use the provider's default behavior."
  };
}

/** Translate a displayed level into the provider's actual effort token. */
export function providerReasoningEffort(provider: string, level: ThinkingLevel): string | undefined {
  if (level === "default" || level === "off") return undefined;
  if (provider === "xai") return level === "max" ? "xhigh" : level;
  if (provider === "openai") return level === "max" ? undefined : level;
  if (provider === "deepseek") return level === "medium" ? undefined : level;
  return undefined;
}
