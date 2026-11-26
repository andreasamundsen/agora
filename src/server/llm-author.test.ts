import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorDebate, AuthorCancelledError } from "./llm";

let dir = "";
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-author-"));
  vi.stubEnv("AGORA_DATA_DIR", dir);
  vi.stubEnv("AGORA_PACKAGED", "0");
  vi.stubEnv("AGORA_LLM_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("AGORA_LLM_MODEL", "test-model");
  vi.stubEnv("AGORA_LLM_API_KEY", "test-key");
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("model authoring", () => {
  it("does not fabricate a local map when the request is cancelled", async () => {
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seenSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      })
    );

    const controller = new AbortController();
    const pending = authorDebate("This should be cancelled", controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(AuthorCancelledError);
    expect(seenSignal?.aborted).toBe(true);
  });

  it("falls back visibly when a valid response contains no argument nodes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reply: "No map was produced.",
                    motion: "Should this work?",
                    thesis: { title: "This should work", text: "This should work." },
                    nodes: [],
                    edges: []
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const result = await authorDebate("This should work");
    expect(result.engine).toBe("local");
    expect(result.warning).toContain("no argument nodes");
    expect(result.debate.nodes.some((node) => node.kind === "argument")).toBe(true);
  });
});
