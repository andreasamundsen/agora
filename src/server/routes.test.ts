import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { reconcileDebate } from "../core/model";
import type { JudgmentRun } from "../core/judgment";
import { createApi } from "./routes";
import { DebateStore } from "./store";

let dir = "";
let server: http.Server | null = null;
let base = "";

async function start(store: DebateStore): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api", createApi(store));
  server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  base = `http://127.0.0.1:${address.port}`;
}

async function stop(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
}

function sampleRun(debateId: string, id = "judgment_api"): JudgmentRun {
  return {
    id,
    debateId,
    createdAt: Date.now(),
    engine: "local",
    judge: { provider: "local", model: "structural" },
    standard: "pro",
    strictness: "balanced",
    verdicts: [],
    links: [],
    clusters: [],
    waves: [],
    balance: { pro: 0, con: 0, margin: 0, threshold: 2, lines: [], assessed: false },
    warnings: [],
    summary: "A test judgment.",
    outcome: "undecided",
    decisive: []
  };
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-routes-"));
  vi.stubEnv("AGORA_DATA_DIR", dir);
  vi.stubEnv("AGORA_PACKAGED", "1");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await stop();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("debate routes", () => {
  it("does not save a map when the create request is cancelled", async () => {
    const store = new DebateStore(dir);
    vi.stubEnv("AGORA_PACKAGED", "0");
    vi.stubEnv("AGORA_LLM_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("AGORA_LLM_MODEL", "test-model");
    vi.stubEnv("AGORA_LLM_API_KEY", "test-key");
    let resolveStarted!: () => void;
    let resolveAborted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        resolveStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              resolveAborted();
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true }
          );
        });
      })
    );

    try {
      await start(store);
      const port = Number(new URL(base).port);
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/debates",
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      request.on("error", () => undefined);
      request.end(JSON.stringify({ text: "A position worth cancelling" }));
      await started;
      request.destroy();
      await aborted;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect((await store.list()).debates).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("saves a locally authored map when create succeeds", async () => {
    const store = new DebateStore(dir);
    await start(store);

    const response = await fetch(`${base}/api/debates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Cities should make public transit free at the point of use." })
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { engine: string; debate: { id: string } };
    expect(body.engine).toBe("local");
    expect((await store.list()).debates.map((debate) => debate.id)).toContain(body.debate.id);
  });

  it("returns library warnings without hiding healthy debates", async () => {
    const store = new DebateStore(dir);
    await fsp.writeFile(path.join(dir, "broken.json"), "not json", "utf8");
    await start(store);

    const response = await fetch(`${base}/api/debates`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { debates: unknown[]; warnings: string[] };
    expect(body.debates).toEqual([]);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("broken");
  });

  it("returns a specific error for an unreadable debate", async () => {
    const store = new DebateStore(dir);
    await fsp.writeFile(path.join(dir, "broken.json"), "{}", "utf8");
    await start(store);

    const response = await fetch(`${base}/api/debates/broken`);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("unreadable-debate");
    expect(body.error).toContain("left untouched");
  });

  it("returns the same unreadable-file error from a chat request", async () => {
    const store = new DebateStore(dir);
    await fsp.writeFile(path.join(dir, "broken.json"), "{}", "utf8");
    await start(store);

    const response = await fetch(`${base}/api/debates/broken/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "What is the crux here?" })
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("unreadable-debate");
  });

  it("does not expose a provider model list in no-model mode", async () => {
    const store = new DebateStore(dir);
    await start(store);

    const response = await fetch(`${base}/api/settings/models`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; models: string[]; message: string };
    expect(body.ok).toBe(false);
    expect(body.models).toEqual([]);
    expect(body.message).toContain("No model mode");
  });

  it("streams judge progress and the final run as NDJSON", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "streamed-judgment",
      motion: "Should cities fund night buses?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Night buses", text: "Cities should fund night buses." },
        {
          id: "support",
          kind: "argument",
          title: "Night workers need it",
          text: "Night workers finish after the last regular bus.",
          stance: "pro",
          premises: ["Those workers finish after midnight."],
          conclusion: "There is an unmet transport need."
        }
      ],
      edges: [{ id: "edge-support", from: "support", to: "thesis", type: "support" }]
    });
    await store.save(debate);
    await start(store);

    const response = await fetch(`${base}/api/debates/${debate.id}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ standard: "preponderance", strictness: "balanced", stream: true })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; phase?: string; run?: { engine: string } });
    expect(events[0]).toMatchObject({ type: "phase", phase: "local" });
    expect(events.at(-1)).toMatchObject({ type: "done", run: { engine: "local" } });
  });

  it("answers a chamber question without changing the map", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "night-buses",
      motion: "Should cities fund night buses?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Night buses", text: "Cities should fund night buses." },
        {
          id: "support",
          kind: "argument",
          title: "Night workers need it",
          text: "Night workers finish after the last regular bus.",
          stance: "pro",
          premises: ["Those workers finish after midnight."],
          conclusion: "There is an unmet transport need."
        },
        {
          id: "attack",
          kind: "argument",
          title: "Demand is too thin",
          text: "Late routes would carry too few passengers to justify the cost.",
          stance: "con",
          premises: ["The cost of a route is fixed."],
          conclusion: "The network would waste money."
        }
      ],
      edges: [
        { id: "edge-support", from: "support", to: "thesis", type: "support" },
        { id: "edge-attack", from: "attack", to: "thesis", type: "attack" }
      ]
    });
    await store.save(debate);
    await start(store);

    const response = await fetch(`${base}/api/debates/night-buses/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "What is the crux here?" })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      debate: typeof debate;
      engine: string;
      warning?: string;
    };
    expect(body.engine).toBe("local");
    expect(body.debate.nodes).toHaveLength(debate.nodes.length);
    expect(body.debate.edges).toHaveLength(debate.edges.length);
    expect(body.debate.chat.some((entry) => entry.text.includes("2 arguments"))).toBe(true);
  });

  it("saves an edited graph while preserving chat and origin", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "editable-map",
      motion: "Should cities fund night buses?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Night buses", text: "Cities should fund night buses." },
        {
          id: "support",
          kind: "argument",
          title: "Night workers need it",
          text: "Night workers finish after the last regular bus.",
          stance: "pro",
          premises: ["Those workers finish after midnight."],
          conclusion: "There is an unmet transport need."
        }
      ],
      edges: [{ id: "edge-support", from: "support", to: "thesis", type: "support" }]
    });
    const saved = await store.save({
      ...debate,
      origin: "imported",
      chat: [{ id: "chat-1", role: "user", text: "Keep this message.", at: 1 }]
    });
    await start(store);

    const response = await fetch(`${base}/api/debates/${saved.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        motion: "Should cities fund all-night buses?",
        thesisText: "Cities should fund all-night bus service.",
        nodes: saved.nodes.map((node) => node.id === "support"
          ? { ...node, title: "Night workers need a reliable ride home", text: "Night shifts end after the last regular bus." }
          : node.id === "thesis"
            ? { ...node, title: "Should cities fund all-night buses?", text: "Cities should fund all-night bus service." }
            : node),
        edges: saved.edges
      })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { debate: typeof debate };
    expect(body.debate.motion).toBe("Should cities fund all-night buses?");
    expect(body.debate.nodes.find((node) => node.id === "support")?.title).toBe(
      "Night workers need a reliable ride home"
    );
    const loaded = await store.get(saved.id);
    expect(loaded?.chat).toHaveLength(1);
    expect(loaded?.chat[0]?.text).toBe("Keep this message.");
    expect(loaded?.origin).toBe("imported");
  });

  it("rejects an edit without a graph", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "bad-edit",
      motion: "A map",
      thesisId: "thesis",
      nodes: [{ id: "thesis", kind: "statement", title: "A map", text: "A map" }],
      edges: []
    });
    await store.save(debate);
    await start(store);

    const response = await fetch(`${base}/api/debates/bad-edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motion: "Only a title" })
    });
    expect(response.status).toBe(400);
  });

  it("rejects an edit that removes the motion or strands an argument", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "integrity-edit",
      motion: "A map",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "A map", text: "A map" },
        { id: "support", kind: "argument", title: "A support", text: "A support", stance: "pro" }
      ],
      edges: [{ id: "support-edge", from: "support", to: "thesis", type: "support" }]
    });
    await store.save(debate);
    await start(store);

    const missingMotion = await fetch(`${base}/api/debates/integrity-edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        motion: "A map",
        thesisText: "A map",
        nodes: [debate.nodes.find((node) => node.id === "support")],
        edges: []
      })
    });
    expect(missingMotion.status).toBe(400);

    const stranded = await fetch(`${base}/api/debates/integrity-edit`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        motion: "A map",
        thesisText: "A map",
        nodes: debate.nodes,
        edges: []
      })
    });
    expect(stranded.status).toBe(400);
  });

  it("saves, lists, reopens, and deletes a judgment for its debate", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "saved-judgment",
      motion: "Should the record be saved?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Saved record", text: "The record should be saved." },
        { id: "support", kind: "argument", title: "A reason", text: "It should.", stance: "pro" }
      ],
      edges: [{ id: "support-edge", from: "support", to: "thesis", type: "support" }]
    });
    await store.save(debate);
    await start(store);

    const created = await fetch(`${base}/api/debates/saved-judgment/judgments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: sampleRun("saved-judgment") })
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      judgment: { id: string; frozenDebate: { nodes: unknown[] }; mapFingerprint: string };
      stale: boolean;
    };
    expect(createdBody.judgment.id).toBe("judgment_api");
    expect(createdBody.judgment.frozenDebate.nodes).toHaveLength(2);
    expect(createdBody.stale).toBe(false);

    const listed = await fetch(`${base}/api/debates/saved-judgment/judgments`);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { judgments: { id: string; stale: boolean }[] };
    expect(listedBody.judgments.map((item) => item.id)).toEqual(["judgment_api"]);
    expect(listedBody.judgments[0]?.stale).toBe(false);

    const opened = await fetch(`${base}/api/debates/saved-judgment/judgments/judgment_api`);
    expect(opened.status).toBe(200);
    const openedBody = (await opened.json()) as { judgment: { run: { summary: string } }; stale: boolean };
    expect(openedBody.judgment.run.summary).toBe("A test judgment.");
    expect(openedBody.stale).toBe(false);

    const deleted = await fetch(`${base}/api/debates/saved-judgment/judgments/judgment_api`, {
      method: "DELETE"
    });
    expect(deleted.status).toBe(200);
    const reopened = await fetch(`${base}/api/debates/saved-judgment/judgments/judgment_api`);
    expect(reopened.status).toBe(404);
  });

  it("marks a saved judgment stale after the map changes", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "stale-judgment",
      motion: "Should the record be saved?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Saved record", text: "The record should be saved." },
        { id: "support", kind: "argument", title: "A reason", text: "It should.", stance: "pro" }
      ],
      edges: [{ id: "support-edge", from: "support", to: "thesis", type: "support" }]
    });
    await store.save(debate);
    await start(store);

    await fetch(`${base}/api/debates/stale-judgment/judgments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: sampleRun("stale-judgment") })
    });

    await store.save({
      ...debate,
      nodes: debate.nodes.map((node) =>
        node.id === "support" ? { ...node, text: "The reason has changed." } : node
      )
    });

    const listed = await fetch(`${base}/api/debates/stale-judgment/judgments`);
    const body = (await listed.json()) as { judgments: { stale: boolean }[] };
    expect(body.judgments[0]?.stale).toBe(true);
  });

  it("rejects a judgment that does not belong to the debate", async () => {
    const store = new DebateStore(dir);
    const debate = reconcileDebate({
      id: "owned-judgment",
      motion: "A map",
      thesisId: "thesis",
      nodes: [{ id: "thesis", kind: "statement", title: "A map", text: "A map" }],
      edges: []
    });
    await store.save(debate);
    await start(store);

    const response = await fetch(`${base}/api/debates/owned-judgment/judgments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: sampleRun("another-debate") })
    });
    expect(response.status).toBe(400);
  });
});
