import { describe, expect, it } from "vitest";
import {
  anthropicThinkingLevels,
  anthropicThinkingStyle,
  geminiThinkingLevel,
  geminiThinkingLevels,
  geminiThinkingStyle,
  isThinkingLevel,
  openRouterThinkingCapability,
  providerReasoningEffort,
  thinkingCapability,
  thinkingTokenBudget
} from "./thinking";

describe("thinking levels", () => {
  it("accepts the shared ladder and rejects invented tiers", () => {
    expect(isThinkingLevel("default")).toBe(true);
    expect(isThinkingLevel("medium")).toBe(true);
    expect(isThinkingLevel("max")).toBe(true);
    expect(isThinkingLevel("ultra")).toBe(false);
    expect(isThinkingLevel("xhigh")).toBe(false);
  });

  it("only offers controls for known thinking-capable models", () => {
    const deepseek = thinkingCapability("deepseek", "deepseek-flash");
    expect(deepseek.supported).toBe(true);
    expect(deepseek.levels).toEqual(["default", "off", "low", "high", "max"]);

    const openai = thinkingCapability("openai", "gpt-5");
    expect(openai.supported).toBe(true);
    expect(openai.levels).toEqual(["default", "low", "medium", "high"]);

    const grok = thinkingCapability("xai", "grok-4.7");
    expect(grok.supported).toBe(true);
    expect(grok.levels).toEqual(["default", "low", "medium", "high", "max"]);

    expect(thinkingCapability("openai", "gpt-4o-mini").supported).toBe(false);
    expect(thinkingCapability("custom", "deepseek-flash").supported).toBe(false);
    const openrouter = thinkingCapability("openrouter", "openai/gpt-4o-mini");
    expect(openrouter.supported).toBe(false);
    expect(openrouter.note).toContain("OpenRouter");
  });

  it("maps the generic level to each provider's wire value", () => {
    expect(providerReasoningEffort("openai", "medium")).toBe("medium");
    expect(providerReasoningEffort("openai", "max")).toBeUndefined();
    expect(providerReasoningEffort("xai", "max")).toBe("xhigh");
    expect(providerReasoningEffort("xai", "medium")).toBe("medium");
    expect(providerReasoningEffort("deepseek", "high")).toBe("high");
    expect(providerReasoningEffort("custom", "high")).toBeUndefined();
  });

  it("offers Claude's adaptive and budgeted thinking modes", () => {
    expect(anthropicThinkingStyle("claude-sonnet-4-6")).toBe("adaptive");
    expect(anthropicThinkingStyle("claude-opus-5-5")).toBe("adaptive");
    expect(anthropicThinkingStyle("claude-sonnet-4-5")).toBe("budget");
    expect(anthropicThinkingStyle("claude-3-7-sonnet-latest")).toBe("budget");
    expect(anthropicThinkingStyle("claude-3-5-sonnet-latest")).toBe("none");

    const adaptive = thinkingCapability("anthropic", "claude-sonnet-4-6");
    expect(adaptive.supported).toBe(true);
    expect(adaptive.levels).toEqual(["default", "off", "low", "medium", "high", "max"]);
    expect(adaptive.note).toContain("adaptive");

    const budget = thinkingCapability("anthropic", "claude-sonnet-4-5");
    expect(budget.supported).toBe(true);
    expect(budget.note).toContain("token budget");
    expect(thinkingCapability("anthropic", "claude-3-5-sonnet-latest").supported).toBe(false);

    expect(anthropicThinkingLevels("claude-opus-5-5")).not.toContain("off");
    expect(anthropicThinkingLevels("claude-sonnet-5-5")).not.toContain("off");
    expect(anthropicThinkingLevels("claude-opus-4-7")).toContain("off");
    expect(thinkingCapability("anthropic", "claude-opus-5-5").note).toContain("always on");
  });

  it("offers only the Gemini thinking levels the model family supports", () => {
    expect(geminiThinkingStyle("gemini-3.5-flash")).toBe("level");
    expect(geminiThinkingStyle("gemini-2.5-flash")).toBe("budget");
    expect(geminiThinkingStyle("gemini-2.0-flash")).toBe("none");
    expect(geminiThinkingLevels("gemini-3.5-flash")).toEqual(["default", "low", "medium", "high"]);
    expect(geminiThinkingLevels("gemini-3-pro-preview")).toEqual(["default", "low", "high"]);
    expect(geminiThinkingLevels("models/gemini-3-pro-preview")).toEqual(["default", "low", "high"]);
    expect(geminiThinkingLevels("gemini-4-hydrogen")).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "max"
    ]);
    expect(geminiThinkingLevels("gemini-2.5-flash")).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "max"
    ]);
    expect(geminiThinkingLevels("gemini-2.5-flash-lite")).toContain("off");
    expect(geminiThinkingLevels("gemini-2.5-pro")).not.toContain("off");
    expect(thinkingCapability("google", "gemini-3.5-flash").supported).toBe(true);
    expect(thinkingCapability("google", "gemini-2.0-flash").supported).toBe(false);

    expect(thinkingTokenBudget("low")).toBe(1_024);
    expect(thinkingTokenBudget("max")).toBe(16_000);
    expect(geminiThinkingLevel("max")).toBe("XHIGH");
    expect(geminiThinkingLevel("default")).toBeUndefined();
  });
});

describe("OpenRouter reasoning metadata", () => {
  it("derives the supported ladder and wire values from a catalogue entry", () => {
    const deepseek = openRouterThinkingCapability({
      supported_parameters: ["reasoning", "reasoning_effort", "max_tokens"],
      reasoning: {
        mandatory: false,
        default_enabled: true,
        default_effort: "high",
        supported_efforts: ["max", "high", "low", "none"]
      }
    });

    expect(deepseek.supported).toBe(true);
    expect(deepseek.levels).toEqual(["default", "off", "low", "high", "max"]);
    expect(deepseek.wireEfforts).toEqual({ low: "low", high: "high", max: "max" });
    expect(deepseek.note).toContain("OpenRouter");

    const grok = openRouterThinkingCapability({
      supported_parameters: ["reasoning"],
      reasoning: {
        mandatory: true,
        supported_efforts: ["xhigh", "high", "medium", "low"]
      }
    });

    expect(grok.supported).toBe(true);
    expect(grok.levels).toEqual(["default", "low", "medium", "high", "max"]);
    expect(grok.wireEfforts?.max).toBe("xhigh");
    expect(grok.note).toContain("mandatory");
  });

  it("offers only on/off when the catalogue has no effort ladder", () => {
    const claude = openRouterThinkingCapability({
      supported_parameters: ["reasoning"],
      reasoning: { mandatory: false, default_enabled: true }
    });

    expect(claude.supported).toBe(true);
    expect(claude.levels).toEqual(["default", "off"]);
    expect(claude.wireEfforts).toEqual({});
  });

  it("does not invent controls without the reasoning gate or reasoning detail", () => {
    expect(
      openRouterThinkingCapability({
        supported_parameters: [],
        reasoning: { mandatory: false, supported_efforts: null }
      }).supported
    ).toBe(false);

    expect(
      openRouterThinkingCapability({
        supported_parameters: ["reasoning"],
        reasoning: null
      }).supported
    ).toBe(false);

    expect(
      openRouterThinkingCapability({
        supported_parameters: ["reasoning"],
        reasoning: { mandatory: true }
      }).supported
    ).toBe(false);
  });

  it("lets detected capability override the static OpenRouter fallback", () => {
    const detected = openRouterThinkingCapability({
      supported_parameters: ["reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["high", "none"] }
    });
    const resolved = thinkingCapability("openrouter", "future/model-1", detected);

    expect(resolved).toBe(detected);
    expect(resolved.levels).toEqual(["default", "off", "high"]);
    expect(providerReasoningEffort("openrouter", "max")).toBe("max");
  });
});
