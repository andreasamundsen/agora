import { describe, expect, it } from "vitest";
import { callAnthropic } from "./anthropic";
import type { StoredSettings } from "./settings";

function settings(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    apiKey: "test-key",
    temperature: 0.7,
    reasoningEffort: "high",
    ...overrides
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

function response(content: unknown[], stopReason = "end_turn"): Response {
  return new Response(JSON.stringify({ content, stop_reason: stopReason }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("Claude native transport", () => {
  it("sends a Messages API request with adaptive thinking and parses text blocks", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const text = await callAnthropic(
      settings(),
      [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Map this debate." }
      ],
      { temperature: 0.2, maxTokens: 1_000 },
      fetchStub(async (url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers as Record<string, string>;
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response([
          { type: "thinking", thinking: "internal" },
          { type: "text", text: '{"ok":true}' }
        ]);
      })
    );

    expect(text).toBe('{"ok":true}');
    expect(seenUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(seenHeaders.Authorization).toBe("Bearer test-key");
    expect(seenHeaders["anthropic-version"]).toBe("2026-10-21");
    expect(body.system).toBe("Return JSON.");
    expect(body.messages).toEqual([{ role: "user", content: "Map this debate." }]);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(16_384);
  });

  it("uses a thinking-token budget on models that predate adaptive thinking", async () => {
    let body: Record<string, unknown> = {};
    await callAnthropic(
      settings({ model: "claude-sonnet-4-5", reasoningEffort: "max" }),
      [{ role: "user", content: "Answer." }],
      {},
      fetchStub(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response([{ type: "text", text: "answer" }]);
      })
    );

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 16_000 });
    expect(body.max_tokens).toBe(20_096);
    expect(body.output_config).toBeUndefined();
  });

  it("sends temperature when the Claude model has no thinking control", async () => {
    const settingsWithoutThinking = settings({
      model: "claude-3-5-sonnet-latest",
      reasoningEffort: "default"
    });
    let body: Record<string, unknown> = {};
    await callAnthropic(
      settingsWithoutThinking,
      [{ role: "user", content: "Answer." }],
      { temperature: 0.4 },
      fetchStub(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response([{ type: "text", text: "answer" }]);
      })
    );

    expect(body.temperature).toBe(0.4);
    expect(body.thinking).toBeUndefined();
  });

  it("does not send a rejected disabled field on an always-thinking Claude model", async () => {
    let body: Record<string, unknown> = {};
    await callAnthropic(
      settings({ model: "claude-opus-5-5", reasoningEffort: "off" }),
      [{ role: "user", content: "Answer." }],
      {},
      fetchStub(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response([{ type: "text", text: "answer" }]);
      })
    );

    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it("clamps legacy Claude 3 output requests to their model ceiling", async () => {
    let body: Record<string, unknown> = {};
    await callAnthropic(
      settings({ model: "claude-3-opus-20240229", reasoningEffort: "default" }),
      [{ role: "user", content: "Answer." }],
      { maxTokens: 4_200 },
      fetchStub(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response([{ type: "text", text: "answer" }]);
      })
    );

    expect(body.max_tokens).toBe(4_096);
    expect(body.temperature).toBe(0.7);
  });

  it("reports hidden reasoning instead of returning an empty answer", async () => {
    await expect(
      callAnthropic(
        settings(),
        [{ role: "user", content: "Answer." }],
        {},
        fetchStub(async () => response([{ type: "thinking", thinking: "internal" }]))
      )
    ).rejects.toThrow("hidden reasoning");
  });
});
