import { describe, expect, it } from "vitest";
import type { StoredSettings } from "./settings";
import { testProviderConnection } from "./provider-test";

function settings(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "test-key",
    temperature: 0.7,
    reasoningEffort: "high",
    ...overrides
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("provider test", () => {
  it("sends a tiny completion to the exact selected model", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: Record<string, unknown> = {};
    const result = await testProviderConnection(
      settings({ baseUrl: "https://api.openai.com/v1/chat/completions" }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
        seenBody = bodyOf(init);
        return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(seenAuth).toBe("Bearer test-key");
    expect(seenBody).toEqual({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      max_tokens: 64
    });
  });

  it("fails when the selected model cannot complete a request", async () => {
    const result = await testProviderConnection(
      settings({ baseUrl: "https://api.example.com/v1", model: "missing-model" }),
      fetchStub(async () => new Response("model not found", { status: 404 }))
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing-model");
    expect(result.message).toContain("404");
  });

  it("uses max_completion_tokens for OpenAI reasoning models", async () => {
    let seenBody: Record<string, unknown> = {};
    const result = await testProviderConnection(
      settings({ model: "o3-mini" }),
      fetchStub(async (_url, init) => {
        seenBody = bodyOf(init);
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenBody.max_completion_tokens).toBe(64);
    expect(seenBody.max_tokens).toBeUndefined();
    expect(seenBody.temperature).toBeUndefined();
  });

  it("tests Claude through the native Messages endpoint", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    const result = await testProviderConnection(
      settings({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6"
      }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers as Record<string, string>;
        seenBody = bodyOf(init);
        return new Response(JSON.stringify({ content: [{ type: "text", text: "ready" }] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(seenHeaders.Authorization).toBe("Bearer test-key");
    expect(seenHeaders["anthropic-version"]).toBe("2026-10-21");
    expect(seenBody).toEqual({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      max_tokens: 64
    });
  });

  it("tests Gemini through the native generateContent endpoint", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const result = await testProviderConnection(
      settings({
        provider: "google",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3.5-flash"
      }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenBody = bodyOf(init);
        return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
    expect(seenBody).toEqual({
      contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
      generationConfig: { maxOutputTokens: 64 }
    });
  });

  it("returns a visible timeout instead of waiting for a hung socket", async () => {
    const result = await testProviderConnection(
      settings(),
      fetchStub(async (_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }),
      25
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("did not answer within");
  });

  it("rejects a non-loopback HTTP base URL before making a request", async () => {
    let called = false;
    const result = await testProviderConnection(
      settings({ baseUrl: "http://example.com/v1" }),
      fetchStub(async () => {
        called = true;
        return new Response("", { status: 200 });
      })
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Use https://");
    expect(called).toBe(false);
  });
});
