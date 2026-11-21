import { describe, expect, it } from "vitest";
import { callGemini } from "./gemini";
import type { StoredSettings } from "./settings";

function settings(overrides: Partial<StoredSettings> = {}): StoredSettings {
  return {
    provider: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-3.5-flash",
    apiKey: "test-key",
    temperature: 0.7,
    reasoningEffort: "medium",
    ...overrides
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

function response(text: string, finishReason = "STOP", thought = false): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason,
          content: { parts: [{ text, ...(thought ? { thought: true } : {}) }] }
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Gemini native transport", () => {
  it("sends contents and a thinking level for Gemini 3", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const text = await callGemini(
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
        return response('{"ok":true}');
      })
    );

    expect(text).toBe('{"ok":true}');
    expect(seenUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    );
    expect(seenHeaders["x-goog-api-key"]).toBe("test-key");
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Return JSON." }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Map this debate." }] }]);
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });
    expect(config.responseMimeType).toBe("application/json");
    expect(config.temperature).toBeUndefined();
    expect(config.maxOutputTokens).toBe(8_192);
  });

  it("uses a thinking budget on Gemini 2.5 and can disable Flash-Lite thinking", async () => {
    let enabledBody: Record<string, unknown> = {};
    await callGemini(
      settings({ model: "gemini-2.5-flash", reasoningEffort: "max" }),
      [{ role: "user", content: "Answer." }],
      {},
      fetchStub(async (_url, init) => {
        enabledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response("answer");
      })
    );
    expect((enabledBody.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 16_000
    });

    let disabledBody: Record<string, unknown> = {};
    await callGemini(
      settings({ model: "gemini-2.5-flash-lite", reasoningEffort: "off" }),
      [{ role: "user", content: "Answer." }],
      {},
      fetchStub(async (_url, init) => {
        disabledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response("answer");
      })
    );
    expect((disabledBody.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingBudget: 0
    });
    expect((disabledBody.generationConfig as Record<string, unknown>).temperature).toBeUndefined();
  });

  it("omits a saved thinking level that the selected Gemini model does not support", async () => {
    let body: Record<string, unknown> = {};
    await callGemini(
      settings({ model: "gemini-3-pro-preview", reasoningEffort: "medium" }),
      [{ role: "user", content: "Answer." }],
      {},
      fetchStub(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response("answer");
      })
    );

    const config = body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toBeUndefined();
    expect(config.temperature).toBeUndefined();
  });

  it("reports hidden thinking instead of returning an empty answer", async () => {
    await expect(
      callGemini(
        settings(),
        [{ role: "user", content: "Answer." }],
        {},
        fetchStub(async () => response("internal", "STOP", true))
      )
    ).rejects.toThrow("internal thinking");
  });

  it("reports an output-limit stop", async () => {
    await expect(
      callGemini(
        settings(),
        [{ role: "user", content: "Answer." }],
        {},
        fetchStub(async () => response("partial", "MAX_TOKENS"))
      )
    ).rejects.toThrow("output limit");
  });
});
