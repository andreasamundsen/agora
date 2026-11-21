import { describe, expect, it } from "vitest";
import {
  isThinkingLevel,
  providerReasoningEffort,
  thinkingCapability
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
  });

  it("maps the generic level to each provider's wire value", () => {
    expect(providerReasoningEffort("openai", "medium")).toBe("medium");
    expect(providerReasoningEffort("openai", "max")).toBeUndefined();
    expect(providerReasoningEffort("xai", "max")).toBe("xhigh");
    expect(providerReasoningEffort("xai", "medium")).toBe("medium");
    expect(providerReasoningEffort("deepseek", "high")).toBe("high");
    expect(providerReasoningEffort("custom", "high")).toBeUndefined();
  });
});
