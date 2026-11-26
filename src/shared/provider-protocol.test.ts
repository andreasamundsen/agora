import { describe, expect, it } from "vitest";
import {
  anthropicBaseUrl,
  anthropicMessagesEndpoint,
  anthropicModelsEndpoint,
  geminiBaseUrl,
  geminiGenerateEndpoint,
  geminiModelsEndpoint,
  providerProtocol
} from "./provider-protocol";

describe("provider protocol helpers", () => {
  it("identifies native protocols", () => {
    expect(providerProtocol("anthropic")).toBe("anthropic");
    expect(providerProtocol("claude")).toBe("anthropic");
    expect(providerProtocol("google")).toBe("gemini");
    expect(providerProtocol("gemini")).toBe("gemini");
    expect(providerProtocol("openai")).toBe("openai");
    expect(providerProtocol("openrouter")).toBe("openai");
    expect(providerProtocol("custom")).toBe("openai");
  });

  it("normalizes pasted Anthropic endpoints", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com");
    expect(anthropicBaseUrl("https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com");
    expect(anthropicMessagesEndpoint("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropicModelsEndpoint("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1/models");
  });

  it("normalizes pasted Gemini endpoints and strips the model namespace", () => {
    expect(geminiBaseUrl("https://generativelanguage.googleapis.com/v1beta")).toBe(
      "https://generativelanguage.googleapis.com"
    );
    expect(geminiModelsEndpoint("https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );
    expect(
      geminiGenerateEndpoint("https://generativelanguage.googleapis.com/v1beta", "models/gemini-3.5-flash")
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    );
  });
});
