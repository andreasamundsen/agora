import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
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
});

afterEach(async () => {
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
      body: JSON.stringify({ text: "Add a counterargument." })
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("unreadable-debate");
  });
});
