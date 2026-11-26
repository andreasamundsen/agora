import { beforeEach, describe, expect, it } from "vitest";
import type { StoredSettings } from "./settings";
import { listProviderModels } from "./provider-models";
import { clearOpenRouterCatalogCache } from "./openrouter-catalog";

function settings(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    provider: "xai",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.7",
    apiKey: "test-key",
    temperature: 0.7,
    reasoningEffort: "high",
    ...overrides
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

describe("provider model discovery", () => {
  beforeEach(() => {
    clearOpenRouterCatalogCache();
  });

  it("uses the normalized models endpoint, sends auth, and sorts unique ids", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const result = await listProviderModels(
      settings({ baseUrl: "https://api.x.ai/v1/chat/completions" }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
        return new Response(
          JSON.stringify({ data: [{ id: "grok-4.7" }, { id: "grok-4" }, { id: "grok-4.7" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    expect(result).toEqual({ ok: true, models: ["grok-4", "grok-4.7"] });
    expect(seenUrl).toBe("https://api.x.ai/v1/models");
    expect(seenAuth).toBe("Bearer test-key");
  });

  it("accepts a models-shaped payload as well as OpenAI's data payload", async () => {
    const result = await listProviderModels(
      settings(),
      fetchStub(async () =>
        new Response(JSON.stringify({ models: [{ id: "grok-4" }] }), { status: 200 })
      )
    );

    expect(result).toEqual({ ok: true, models: ["grok-4"] });
  });

  it("uses the native Anthropic model list and auth headers", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const result = await listProviderModels(
      settings({
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-6"
      }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({ data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-4-6" }] }),
          { status: 200 }
        );
      })
    );

    expect(result).toEqual({ ok: true, models: ["claude-opus-5-5", "claude-sonnet-4-6"] });
    expect(seenUrl).toBe("https://api.anthropic.com/v1/models");
    expect(seenHeaders.Authorization).toBe("Bearer test-key");
    expect(seenHeaders["anthropic-version"]).toBe("2026-10-21");
  });

  it("uses the native Gemini model list, strips the models/ prefix, and sends the key header", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const result = await listProviderModels(
      settings({ provider: "google", baseUrl: "https://generativelanguage.googleapis.com" }),
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            models: [
              { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] }
            ]
          }),
          { status: 200 }
        );
      })
    );

    expect(result).toEqual({ ok: true, models: ["gemini-2.5-pro", "gemini-3.5-flash"] });
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(seenHeaders["x-goog-api-key"]).toBe("test-key");
  });

  it("returns a visible error when the provider rejects model discovery", async () => {
    const result = await listProviderModels(
      settings(),
      fetchStub(async () => new Response("not allowed", { status: 403 }))
    );

    expect(result.ok).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.message).toContain("403");
  });

  it("returns a manual-entry message when the provider lists no models", async () => {
    const result = await listProviderModels(
      settings(),
      fetchStub(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("manually");
  });

  it("does not request an unsafe provider URL", async () => {
    let called = false;
    const result = await listProviderModels(
      settings({ baseUrl: "http://example.com/v1" }),
      fetchStub(async () => {
        called = true;
        return new Response("", { status: 200 });
      })
    );

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("returns OpenRouter reasoning capabilities and reuses the catalogue cache", async () => {
    let calls = 0;
    let seenUrl = "";
    let seenAuth = "";
    const result = await listProviderModels(
      settings({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-v4.1-flash-1017"
      }),
      fetchStub(async (url, init) => {
        calls += 1;
        seenUrl = url;
        seenAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "deepseek/deepseek-v4.1-flash-1017",
                supported_parameters: ["reasoning", "reasoning_effort"],
                reasoning: {
                  mandatory: false,
                  supported_efforts: ["max", "high", "low", "none"]
                }
              },
              {
                id: "openai/gpt-4o-mini",
                supported_parameters: ["temperature"],
                reasoning: null
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      "deepseek/deepseek-v4.1-flash-1017",
      "openai/gpt-4o-mini"
    ]);
    expect(result.capabilities?.["deepseek/deepseek-v4.1-flash-1017"]?.levels).toEqual([
      "default",
      "off",
      "low",
      "high",
      "max"
    ]);
    expect(result.capabilities?.["openai/gpt-4o-mini"]?.supported).toBe(false);
    expect(seenUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(seenAuth).toBe("Bearer test-key");

    const cached = await listProviderModels(
      settings({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-v4.1-flash-1017"
      }),
      fetchStub(async () => {
        calls += 1;
        return new Response("", { status: 500 });
      })
    );
    expect(cached.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("refreshes the OpenRouter catalogue when asked", async () => {
    let calls = 0;
    const fetchCatalog = fetchStub(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: [{ id: calls === 1 ? "old/model" : "new/model", supported_parameters: [], reasoning: null }]
        }),
        { status: 200 }
      );
    });

    const first = await listProviderModels(
      settings({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }),
      fetchCatalog
    );
    const second = await listProviderModels(
      settings({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }),
      fetchCatalog,
      undefined,
      true
    );

    expect(first.models).toEqual(["old/model"]);
    expect(second.models).toEqual(["new/model"]);
    expect(calls).toBe(2);
  });
});
