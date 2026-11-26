import { afterEach, describe, expect, it, vi } from "vitest";
import type { Debate } from "../core/model";
import type { JudgmentRun } from "../core/judgment";
import type { JudgeProgressEvent } from "../shared/judge-progress";
import { ApiError, createDebate, deleteSavedJudgment, fetchSavedJudgment, fetchSavedJudgments, judgeDebateStream, saveDebate, saveJudgmentRun } from "./api";

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveDebate", () => {
  it("sends only the editable graph fields as a PATCH", async () => {
    const debate = {
      id: "debate-1",
      motion: "A motion",
      thesisText: "A thesis",
      nodes: [{ id: "thesis", kind: "statement", title: "A motion", text: "A thesis", stance: "neutral", speaker: "you", tags: [] }],
      edges: []
    } as unknown as Debate;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ debate }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveDebate("debate-1", debate);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/debates/debate-1");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(String(options.body))).toEqual({
      motion: "A motion",
      thesisText: "A thesis",
      nodes: debate.nodes,
      edges: []
    });
  });
});

describe("createDebate", () => {
  it("forwards the cancellation signal to the map request", async () => {
    const debate = { id: "debate-1" } as Debate;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ debate, engine: "llm" }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await createDebate("A position worth mapping", controller.signal);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBe(controller.signal);
  });
});

describe("judgeDebateStream", () => {
  it("parses split progress lines and returns the final run", async () => {
    const run = { engine: "local" } as JudgmentRun;
    const progress: JudgeProgressEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonResponse([
          '{"type":"phase","phase":"assessing","totalLinks":2}\n{"type":"link-start","link":',
          '{"edgeId":"edge-support","index":0,"total":2,"type":"support"}}\n',
          '{"type":"link-done","link":{"edgeId":"edge-support","index":0,"total":2,"type":"support"},"completed":1,"durationMs":1200,"completedAt":1}\n',
          `{"type":"done","run":${JSON.stringify(run)}}\n`
        ])
      )
    );

    const result = await judgeDebateStream(
      "debate-1",
      { standard: "preponderance", strictness: "balanced" },
      { onProgress: (event) => progress.push(event) }
    );

    expect(result.run).toEqual(run);
    expect(progress.map((event) => event.type)).toEqual(["phase", "link-start", "link-done"]);
  });

  it("turns a stream error event into an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonResponse(['{"type":"error","error":"The bench could not finish."}\n'])
      )
    );

    await expect(
      judgeDebateStream("debate-1", { standard: "preponderance", strictness: "balanced" })
    ).rejects.toEqual(new ApiError("The bench could not finish.", 500));
  });
});

describe("saved judgment requests", () => {
  it("uses the debate-scoped judgment endpoints", async () => {
    const saved = {
      id: "judgment-1",
      debateId: "debate/one",
      savedAt: 1,
      run: { id: "run-1" },
      snapshot: {},
      frozenDebate: { nodes: [], edges: [] },
      mapFingerprint: "abc"
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ judgments: [], mapFingerprint: "abc", judgment: saved, stale: true, ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSavedJudgments("debate/one");
    await fetchSavedJudgment("debate/one", "judgment/1");
    await saveJudgmentRun("debate/one", { id: "run-1" } as JudgmentRun);
    await deleteSavedJudgment("debate/one", "judgment/1");

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "/api/debates/debate%2Fone/judgments",
      "/api/debates/debate%2Fone/judgments/judgment%2F1",
      "/api/debates/debate%2Fone/judgments",
      "/api/debates/debate%2Fone/judgments/judgment%2F1"
    ]);
    expect(calls.map(([, options]) => options.method ?? "GET")).toEqual(["GET", "GET", "POST", "DELETE"]);
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({ run: { id: "run-1" } });
  });
});
