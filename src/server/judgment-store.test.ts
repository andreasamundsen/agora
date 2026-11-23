import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Debate, reconcileDebate } from "../core/model";
import { solveJudgment, type JudgmentRun } from "../core/judgment";
import { JudgmentStore } from "./judgment-store";

let dir = "";
let store: JudgmentStore;

function sampleDebate(): Debate {
  return reconcileDebate({
    id: "sample",
    motion: "Should the sample hold?",
    thesisId: "thesis",
    thesisText: "The sample should hold.",
    nodes: [
      { id: "thesis", kind: "statement", title: "The sample", text: "The sample should hold." },
      { id: "support", kind: "argument", title: "A reason", text: "Because it follows.", stance: "pro" }
    ],
    edges: [{ id: "support-edge", from: "support", to: "thesis", type: "support" }]
  });
}

function sampleRun(id: string, debate: Debate): JudgmentRun {
  return {
    id,
    debateId: debate.id,
    createdAt: 1000,
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
    summary: "A saved test run.",
    outcome: "undecided",
    decisive: []
  };
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-judgments-"));
  store = new JudgmentStore(dir);
  await store.init();
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("judgment store", () => {
  it("round-trips a saved judgment", async () => {
    const debate = sampleDebate();
    const run = sampleRun("judgment_one", debate);
    const snapshot = solveJudgment(debate, run.links, run.clusters, run.standard, run.strictness, false);
    const saved = await store.save(debate, run, snapshot);

    expect(saved.id).toBe("judgment_one");
    expect(saved.frozenDebate.chat).toEqual([]);
    expect(saved.mapFingerprint).toMatch(/^[0-9a-f]{16}$/);

    const loaded = await store.get("sample", "judgment_one");
    expect(loaded?.run.summary).toBe("A saved test run.");
    expect(loaded?.snapshot).toEqual(snapshot);
    expect(loaded?.frozenDebate.nodes.map((node) => node.id)).toEqual(["thesis", "support"]);
  });

  it("lists newest first and marks a saved run stale after the live map changes", async () => {
    const debate = sampleDebate();
    const first = await store.save(
      debate,
      sampleRun("judgment_first", debate),
      solveJudgment(debate, [], [], "pro", "balanced", false)
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.save(
      debate,
      sampleRun("judgment_second", debate),
      solveJudgment(debate, [], [], "pro", "balanced", false)
    );

    const fresh = await store.list(debate);
    expect(fresh.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(fresh.every((entry) => !entry.stale)).toBe(true);

    debate.nodes[1]!.text = "A changed reason.";
    const stale = await store.list(debate);
    expect(stale.every((entry) => entry.stale)).toBe(true);
  });

  it("deletes one run and then the whole debate's history", async () => {
    const debate = sampleDebate();
    await store.save(debate, sampleRun("judgment_one", debate), solveJudgment(debate, [], [], "pro", "balanced", false));
    await store.save(debate, sampleRun("judgment_two", debate), solveJudgment(debate, [], [], "pro", "balanced", false));

    await store.delete("sample", "judgment_one");
    expect(await store.get("sample", "judgment_one")).toBeNull();
    expect((await store.list(debate)).map((entry) => entry.id)).toEqual(["judgment_two"]);

    await store.deleteForDebate("sample");
    expect(await store.list(debate)).toEqual([]);
  });

  it("rejects unsafe identifiers", async () => {
    const debate = sampleDebate();
    await expect(store.get("../sample", "judgment_one")).resolves.toBeNull();
    await expect(
      store.save(debate, sampleRun("../escape", debate), solveJudgment(debate, [], [], "pro", "balanced", false))
    ).rejects.toThrow("Invalid judgment id");
  });
});
