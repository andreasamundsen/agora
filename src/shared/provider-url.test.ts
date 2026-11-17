import { describe, expect, it } from "vitest";
import {
  chatEndpoint,
  isLocalProvider,
  modelsEndpoint,
  providerHost,
  providerUrlProblem
} from "./provider-url";

describe("provider URLs", () => {
  it("normalizes chat and models paths", () => {
    expect(chatEndpoint("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/chat/completions");
    expect(chatEndpoint("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(modelsEndpoint("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/models");
    expect(modelsEndpoint("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/models"
    );
  });

  it("treats loopback names as local", () => {
    expect(isLocalProvider("http://localhost:1234/v1")).toBe(true);
    expect(isLocalProvider("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalProvider("http://[::1]:11434/v1")).toBe(true);
    expect(isLocalProvider("http://0.0.0.0:11434/v1")).toBe(false);
    expect(isLocalProvider("https://api.openai.com/v1")).toBe(false);
  });

  it("rejects malformed URLs and embedded credentials", () => {
    expect(providerUrlProblem("not a url", true)).toBe("Base URL must start with http:// or https://.");
    expect(providerUrlProblem("ftp://example.com/v1", true)).toBe(
      "Base URL must start with http:// or https://."
    );
    expect(providerUrlProblem("https://user:pass@example.com/v1", true)).toBe(
      "Base URL must not include credentials."
    );
  });

  it("rejects cleartext remote endpoints when a key is present", () => {
    expect(providerUrlProblem("http://example.com/v1", true)).toBe(
      "Use https:// for a remote provider when an API key is present."
    );
    expect(providerUrlProblem("http://localhost:1234/v1", true)).toBeNull();
    expect(providerUrlProblem("http://example.com/v1", false)).toBeNull();
    expect(providerUrlProblem("https://example.com/v1", true)).toBeNull();
  });

  it("reports the destination host without exposing credentials", () => {
    expect(providerHost("https://api.openai.com/v1")).toBe("api.openai.com");
    expect(providerHost("not a url")).toBe("");
  });
});
