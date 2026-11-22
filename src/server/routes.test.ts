import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { reconcileDebate } from "../core/model";
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
});
