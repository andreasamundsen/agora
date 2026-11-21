import { describe, expect, it } from "vitest";
import type { StoredSettings } from "./settings";
import { listProviderModels } from "./provider-models";

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
});
