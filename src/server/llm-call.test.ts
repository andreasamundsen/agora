import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "./llm";
import type { StoredSettings } from "./settings";

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
});
