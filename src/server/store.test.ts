import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DebateStore, DebateReadError } from "./store";
import { Debate, reconcileDebate } from "../core/model";

let dir = "";
let store: DebateStore;

function sample(id: string, thesis = `Is ${id} true?`): Debate {
  return reconcileDebate({
    id,
    motion: thesis,
    thesisId: "thesis",
    thesisText: thesis,
    nodes: [
      { id: "thesis", kind: "statement", title: thesis, text: thesis, stance: "neutral" },
      { id: `${id}-support`, kind: "argument", title: "A support", text: "Because it follows.", stance: "pro" }
    ],
    edges: [{ from: `${id}-support`, to: "thesis", type: "support" }]
  });
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-store-"));
  store = new DebateStore(dir);
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("debate store", () => {
  it("round-trips a debate", async () => {
    const saved = await store.save(sample("alpha"));
    const loaded = await store.get("alpha");
    expect(loaded?.id).toBe("alpha");
    expect(loaded?.nodes.map((node) => node.id)).toContain("alpha-support");
    expect(saved.updatedAt).toBeGreaterThan(0);
  });

  it("returns missing debates as null, not as corrupt", async () => {
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("reports corrupt files and leaves them alone", async () => {
    await fsp.writeFile(path.join(dir, "broken.json"), "{not json", "utf8");
    const result = await store.list();
    expect(result.debates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("broken");
    await expect(store.get("broken")).rejects.toBeInstanceOf(DebateReadError);
    expect(await fsp.readFile(path.join(dir, "broken.json"), "utf8")).toBe("{not json");
  });

  it("keeps valid debates visible when another file is corrupt", async () => {
    await store.save(sample("good"));
    await fsp.writeFile(path.join(dir, "bad.json"), JSON.stringify({ nodes: [] }), "utf8");
    const result = await store.list();
    expect(result.debates.map((item) => item.id)).toEqual(["good"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("serializes concurrent saves", async () => {
    await Promise.all([store.save(sample("one")), store.save(sample("two"))]);
    const result = await store.list();
    expect(result.debates.map((item) => item.id).sort()).toEqual(["one", "two"]);
  });
});
