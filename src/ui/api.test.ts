import { afterEach, describe, expect, it, vi } from "vitest";
import type { JudgmentRun } from "../core/judgment";
import type { JudgeProgressEvent } from "../shared/judge-progress";
import { ApiError, judgeDebateStream } from "./api";

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
