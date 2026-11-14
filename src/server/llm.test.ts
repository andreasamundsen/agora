import { describe, expect, it } from "vitest";
import { supportsDeepSeekThinking } from "./llm";

describe("DeepSeek thinking support", () => {
  it("enables thinking controls only for current DeepSeek thinking models", () => {
    expect(supportsDeepSeekThinking({ provider: "deepseek", model: "deepseek-flash" })).toBe(true);
    expect(supportsDeepSeekThinking({ provider: "deepseek", model: "deepseek-v4-pro" })).toBe(true);
    expect(supportsDeepSeekThinking({ provider: "deepseek", model: "deepseek-v4-flash" })).toBe(true);
  });

  it("leaves legacy and non-DeepSeek models on the old request shape", () => {
    expect(supportsDeepSeekThinking({ provider: "deepseek", model: "deepseek-chat" })).toBe(false);
    expect(supportsDeepSeekThinking({ provider: "openai", model: "deepseek-flash" })).toBe(false);
    expect(supportsDeepSeekThinking({ provider: "custom", model: "deepseek-flash" })).toBe(false);
  });
});
