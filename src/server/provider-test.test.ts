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

describe("provider test", () => {
  it("uses the normalized models endpoint and sends auth", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const result = await testProviderConnection(
      settings({ baseUrl: "https://api.openai.com/v1/chat/completions" }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("https://api.openai.com/v1/models");
    expect(seenAuth).toBe("Bearer test-key");
  });

  it("falls back to chat completions if models is unavailable", async () => {
    const urls: string[] = [];
    const result = await testProviderConnection(
      settings({ baseUrl: "https://api.example.com/v1" }),
      fetchStub(async (url) => {
        urls.push(url);
        if (url.endsWith("/models")) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(urls).toEqual([
      "https://api.example.com/v1/models",
      "https://api.example.com/v1/chat/completions"
    ]);
  });

  it("tests Claude through its native model list", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const result = await testProviderConnection(
      settings({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6"
      }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe("https://api.anthropic.com/v1/models");
    expect(seenHeaders.Authorization).toBe("Bearer test-key");
    expect(seenHeaders["anthropic-version"]).toBe("2026-10-21");
  });

  it("falls back to Gemini's native generateContent endpoint", async () => {
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const result = await testProviderConnection(
      settings({
        provider: "google",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-3.5-flash"
      }),
      fetchStub(async (url, init) => {
        urls.push(url);
        if (url.endsWith("/models")) return new Response("not found", { status: 404 });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      })
    );

    expect(result.ok).toBe(true);
    expect(urls).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    ]);
    expect(bodies[0]).toEqual({
      contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
      generationConfig: { maxOutputTokens: 8, temperature: 0 }
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
