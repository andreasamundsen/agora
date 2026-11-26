import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "./llm";
import type { StoredSettings } from "./settings";
import { clearOpenRouterCatalogCache } from "./openrouter-catalog";

const localSettings: StoredSettings = {
  provider: "local",
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "qwen-test",
  apiKey: "",
  temperature: 0.7,
  reasoningEffort: "off"
};

const remoteSettings: StoredSettings = {
  provider: "custom",
  baseUrl: "https://provider.example/v1",
  model: "remote-test",
  apiKey: "test-key",
  temperature: 0.7,
  reasoningEffort: "off"
};

const openaiReasoningSettings: StoredSettings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5",
  apiKey: "test-key",
  temperature: 0.7,
  reasoningEffort: "high"
};

const xaiSettings: StoredSettings = {
  provider: "xai",
  baseUrl: "https://api.x.ai/v1",
  model: "grok-4.7",
  apiKey: "test-key",
  temperature: 0.7,
  reasoningEffort: "max"
};

const deepseekSettings: StoredSettings = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  apiKey: "test-key",
  temperature: 0.7,
  reasoningEffort: "high"
};

const openRouterSettings: StoredSettings = {
  provider: "openai",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "deepseek/deepseek-v4.1-flash-1017",
  apiKey: "test-key",
  temperature: 0.7,
  reasoningEffort: "high"
};

function chatResponse(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content, ...extra } }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearOpenRouterCatalogCache();
});

describe("callModel output budgets", () => {
  it("gives loopback providers room for local reasoning before the final answer", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await expect(callModel(localSettings, [{ role: "user", content: "map this" }])).resolves.toBe(
      '{"reply":"ok"}'
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.max_tokens).toBe(12_000);
  });

  it("keeps remote explicit and default budgets unchanged", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(remoteSettings, [{ role: "user", content: "judge this" }], { maxTokens: 1800 });
    expect(bodies[0]?.max_tokens).toBe(1800);

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(remoteSettings, [{ role: "user", content: "map this" }]);
    expect(bodies[1]?.max_tokens).toBe(4200);
  });

  it("omits JSON mode for prose calls", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse("Oslo");
      })
    );

    await expect(
      callModel(remoteSettings, [{ role: "user", content: "What is the capital of Norway?" }], {
        jsonMode: false
      })
    ).resolves.toBe("Oslo");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format).toBeUndefined();
  });

  it("reports hidden reasoning instead of accepting an empty final answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        chatResponse("", { reasoning_content: "The model thought about the map but stopped." })
      )
    );

    await expect(callModel(localSettings, [{ role: "user", content: "map this" }])).rejects.toThrow(
      /hidden reasoning/i
    );
  });

  it("keeps the timeout active while reading a stalled response body", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          const stream = new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("aborted", "AbortError")),
                { once: true }
              );
            }
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        })
      );

      const pending = expect(
        callModel(remoteSettings, [{ role: "user", content: "map this" }])
      ).rejects.toThrow(/did not finish within 150 seconds/i);
      await vi.advanceTimersByTimeAsync(150_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses completion tokens and effort for an OpenAI reasoning model", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(openaiReasoningSettings, [{ role: "user", content: "map this" }], {
      maxTokens: 1800
    });

    expect(bodies[0]?.max_completion_tokens).toBe(16_384);
    expect(bodies[0]?.max_tokens).toBeUndefined();
    expect(bodies[0]?.reasoning_effort).toBe("high");
    expect(bodies[0]?.temperature).toBeUndefined();
  });

  it("keeps non-reasoning OpenAI models on the old request shape", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(
      { ...openaiReasoningSettings, model: "gpt-4o-mini", reasoningEffort: "high" },
      [{ role: "user", content: "map this" }],
      { maxTokens: 1800 }
    );

    expect(bodies[0]?.max_tokens).toBe(1800);
    expect(bodies[0]?.max_completion_tokens).toBeUndefined();
    expect(bodies[0]?.reasoning_effort).toBeUndefined();
    expect(bodies[0]?.temperature).toBe(0.7);
  });

  it("keeps DeepSeek thinking on its existing enabled/disabled request shape", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(deepseekSettings, [{ role: "user", content: "map this" }]);
    expect(bodies[0]?.max_tokens).toBe(16_384);
    expect(bodies[0]?.thinking).toEqual({ type: "enabled" });
    expect(bodies[0]?.reasoning_effort).toBe("high");
    expect(bodies[0]?.temperature).toBeUndefined();

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(
      { ...deepseekSettings, reasoningEffort: "off" },
      [{ role: "user", content: "map this" }]
    );
    expect(bodies[1]?.max_tokens).toBe(4200);
    expect(bodies[1]?.thinking).toEqual({ type: "disabled" });
    expect(bodies[1]?.reasoning_effort).toBeUndefined();
    expect(bodies[1]?.temperature).toBe(0.7);
  });

  it("uses OpenRouter's published metadata for the request shape and budget", async () => {
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/models")) {
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
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(openRouterSettings, [{ role: "user", content: "map this" }], {
      maxTokens: 1800
    });

    expect(urls).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/chat/completions"
    ]);
    expect(bodies[0]?.max_tokens).toBe(16_384);
    expect(bodies[0]?.max_completion_tokens).toBeUndefined();
    expect(bodies[0]?.reasoning).toEqual({ effort: "high" });
    expect(bodies[0]?.reasoning_effort).toBeUndefined();
    expect(bodies[0]?.temperature).toBeUndefined();
  });

  it("sends an explicit OpenRouter off state without inventing an effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "deepseek/deepseek-v4.1-flash-1017",
                  supported_parameters: ["reasoning"],
                  reasoning: { mandatory: false, supported_efforts: ["high", "none"] }
                }
              ]
            }),
            { status: 200 }
          );
        }
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(
      { ...openRouterSettings, reasoningEffort: "off" },
      [{ role: "user", content: "map this" }]
    );

    expect(bodies[0]?.reasoning).toEqual({ enabled: false });
    expect(bodies[0]?.max_tokens).toBe(4200);
  });

  it("clamps an OpenRouter level the catalogue does not advertise", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "deepseek/deepseek-v4.1-flash-1017",
                  supported_parameters: ["reasoning"],
                  reasoning: { mandatory: false, supported_efforts: ["high", "none"] }
                }
              ]
            }),
            { status: 200 }
          );
        }
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(
      { ...openRouterSettings, reasoningEffort: "medium" },
      [{ role: "user", content: "map this" }]
    );

    expect(bodies[0]?.reasoning).toBeUndefined();
    expect(bodies[0]?.reasoning_effort).toBeUndefined();
    expect(bodies[0]?.max_tokens).toBe(16_384);
  });

  it("maps xAI Max to xhigh without sending temperature", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return chatResponse('{"reply":"ok"}');
      })
    );

    await callModel(xaiSettings, [{ role: "user", content: "map this" }]);

    expect(bodies[0]?.max_tokens).toBe(32_768);
    expect(bodies[0]?.reasoning_effort).toBe("xhigh");
    expect(bodies[0]?.temperature).toBeUndefined();
  });

  it("dispatches Claude through the native Messages endpoint", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: '{"reply":"ok"}' }], stop_reason: "end_turn" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    await expect(
      callModel(
        {
          ...openaiReasoningSettings,
          provider: "anthropic",
          baseUrl: "https://api.anthropic.com",
          model: "claude-sonnet-4-6"
        },
        [{ role: "user", content: "map this" }]
      )
    ).resolves.toBe('{"reply":"ok"}');
    expect(urls).toEqual(["https://api.anthropic.com/v1/messages"]);
  });

  it("dispatches Gemini through the native generateContent endpoint", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"reply":"ok"}' }] } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    await expect(
      callModel(
        {
          ...openaiReasoningSettings,
          provider: "google",
          baseUrl: "https://generativelanguage.googleapis.com",
          model: "gemini-3.5-flash"
        },
        [{ role: "user", content: "map this" }]
      )
    ).resolves.toBe('{"reply":"ok"}');
    expect(urls).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    ]);
  });
});
