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

export type AnthropicThinkingStyle = "adaptive" | "budget" | "none";
export type GeminiThinkingStyle = "level" | "budget" | "none";

function claudeVersion(model: string): { major: number; minor: number } | null {
  const named = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/i.exec(model);
  const legacy = /^claude-(\d+)(?:-(\d+))?(?:-|$)/i.exec(model);
  const match = named ?? legacy;
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] ? Number(match[2]) : 0
  };
}

/** Claude 4.6+ uses adaptive thinking; older thinking models use a token budget. */
export function anthropicThinkingStyle(model: string): AnthropicThinkingStyle {
  const id = model.trim().toLowerCase();
  if (!id.startsWith("claude-")) return "none";
  const version = claudeVersion(id);
  if (!version) return /^claude-(?:mythos|fable)-/i.test(id) ? "adaptive" : "none";
  if (version.major >= 5 || (version.major === 4 && version.minor >= 6)) return "adaptive";
  if (version.major === 4 || (version.major === 3 && version.minor >= 7)) return "budget";
  return "none";
}

/**
 * Some current Claude models always think and reject `thinking: {type:"disabled"}`.
 * Do not offer a level that the provider will reject.
 */
export function anthropicThinkingLevels(model: string): ThinkingLevel[] {
  if (anthropicThinkingStyle(model) === "none") return [];
  const id = model.trim().toLowerCase();
  const alwaysOn = /^claude-(?:fable-|mythos-|opus-5-5|sonnet-5-5)/.test(id);
  return alwaysOn
    ? ["default", "low", "medium", "high", "max"]
    : ["default", "off", "low", "medium", "high", "max"];
}

function geminiVersion(model: string): { major: number; minor: number } | null {
  const match = /^gemini-(\d+)(?:[.-](\d+))?/i.exec(model.trim().replace(/^models\//, ""));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] ? Number(match[2]) : 0
  };
}

/** Gemini 3+ uses thinkingLevel; Gemini 2.5 uses a thinkingBudget. */
export function geminiThinkingStyle(model: string): GeminiThinkingStyle {
  const version = geminiVersion(model);
  if (!version) return "none";
  if (version.major >= 3) return "level";
  if (version.major === 2 && version.minor >= 5) return "budget";
  return "none";
}

export function geminiThinkingLevels(model: string): ThinkingLevel[] {
  const id = model.trim().toLowerCase().replace(/^models\//, "");
  if (geminiThinkingStyle(id) === "level") {
    if (/^gemini-3-pro-preview/.test(id)) return ["default", "low", "high"];
    if (/^gemini-3\.1-flash-lite-image/.test(id)) return ["default", "high"];
    const levels: ThinkingLevel[] = ["default", "low", "medium", "high"];
    if (/^gemini-4-(?:hydrogen|neon)/.test(id)) levels.push("max");
    return levels;
  }
  if (geminiThinkingStyle(id) === "budget") {
    const levels: ThinkingLevel[] = ["default", "low", "medium", "high", "max"];
    if (/^gemini-2\.5-flash-lite/.test(id)) levels.splice(1, 0, "off");
    return levels;
  }
  return [];
}

/** Shared token budgets for providers whose thinking control is a token budget. */
export function thinkingTokenBudget(level: ThinkingLevel): number {
  if (level === "low") return 1_024;
  if (level === "medium") return 4_096;
  if (level === "high") return 10_000;
  if (level === "max") return 16_000;
  return 0;
}

export function geminiThinkingLevel(level: ThinkingLevel): string | undefined {
  if (level === "low") return "LOW";
  if (level === "medium") return "MEDIUM";
  if (level === "high") return "HIGH";
  if (level === "max") return "XHIGH";
  return undefined;
}

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

  if (provider === "anthropic" || provider === "claude") {
    const style = anthropicThinkingStyle(id);
    if (style === "none") {
      return {
        supported: false,
        levels: [],
        note: "This Claude model does not expose an adjustable thinking level in Agora."
      };
    }
    const levels = anthropicThinkingLevels(id);
    const offNote = levels.includes("off")
      ? ""
      : " Off is hidden because thinking is always on for this model.";
    return {
      supported: true,
      levels,
      note:
        (style === "adaptive"
          ? "Claude uses adaptive thinking here; the selected level is sent as output effort."
          : "Claude uses a thinking-token budget. Higher levels take longer and cost more, but the provider may stop before the budget.") +
        offNote
    };
  }

  if (provider === "google" || provider === "gemini") {
    const style = geminiThinkingStyle(id);
    const levels = geminiThinkingLevels(id);
    if (style === "none" || levels.length === 0) {
      return {
        supported: false,
        levels: [],
        note: "This Gemini model does not expose an adjustable thinking level in Agora."
      };
    }
    return {
      supported: true,
      levels,
      note:
        style === "level"
          ? "Gemini 3 and later use thinking levels; Max is offered only where the model supports XHIGH."
          : "Gemini 2.5 uses a thinking-token budget. Off is hidden on models that cannot disable thinking."
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
