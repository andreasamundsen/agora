import fsp from "node:fs/promises";
import path from "node:path";
import { Debate } from "../core/model";
import {
  debateFingerprint,
  frozenDebateCopy,
  type JudgmentRun,
  type JudgmentSnapshot,
  type SavedJudgment,
  type SavedJudgmentSummary
} from "../core/judgment";
import { dataDir } from "./settings";
import { replaceFile } from "./atomic-write";

/**
 * Saved judgments are stored separately from debates. The debate's library
 * file stays small; the run carries its own frozen graph so an old sitting
 * can still be reopened after the live map has moved on.
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function validId(id: string): boolean {
  return ID_RE.test(id);
}

export class JudgmentStore {
  private dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir = path.join(dataDir(), "judgments")) {
    this.dir = dir;
  }

  get directory(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private debateDir(debateId: string): string {
    if (!validId(debateId)) throw new Error("Invalid debate id");
    return path.join(this.dir, debateId);
  }

  private file(debateId: string, runId: string): string {
    if (!validId(debateId)) throw new Error("Invalid debate id");
    if (!validId(runId)) throw new Error("Invalid judgment id");
    return path.join(this.dir, debateId, `${runId}.json`);
  }

  async save(debate: Debate, run: JudgmentRun, snapshot: JudgmentSnapshot): Promise<SavedJudgment> {
    if (run.debateId !== debate.id) throw new Error("The judgment does not belong to this debate.");
    const saved: SavedJudgment = {
      id: run.id,
      debateId: debate.id,
      savedAt: Date.now(),
      mapFingerprint: debateFingerprint(debate),
      frozenDebate: frozenDebateCopy(debate),
      run,
      snapshot
    };
    const file = this.file(debate.id, run.id);
    await this.enqueue(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(saved, null, 2), "utf8");
      await replaceFile(tmp, file);
    });
    return saved;
  }

  async get(debateId: string, runId: string): Promise<SavedJudgment | null> {
    let file: string;
    try {
      file = this.file(debateId, runId);
    } catch {
      return null;
    }
    try {
      const raw = await fsp.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as SavedJudgment;
      if (!parsed || parsed.debateId !== debateId || parsed.id !== runId) return null;
      if (!parsed.frozenDebate || !Array.isArray(parsed.frozenDebate.nodes) || !Array.isArray(parsed.frozenDebate.edges)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async list(debate: Debate): Promise<SavedJudgmentSummary[]> {
    let dir: string;
    try {
      dir = this.debateDir(debate.id);
    } catch {
      return [];
    }
    const currentFingerprint = debateFingerprint(debate);
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    const summaries: SavedJudgmentSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const runId = file.slice(0, -5);
      if (!validId(runId)) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, file), "utf8");
        const saved = JSON.parse(raw) as SavedJudgment;
        if (!saved?.run || saved.debateId !== debate.id || saved.id !== runId) continue;
        if (!saved.frozenDebate || !Array.isArray(saved.frozenDebate.nodes) || !Array.isArray(saved.frozenDebate.edges)) continue;
        summaries.push({
          id: saved.id,
          debateId: saved.debateId,
          savedAt: saved.savedAt,
          createdAt: saved.run.createdAt,
          mapFingerprint: saved.mapFingerprint,
          outcome: saved.run.outcome,
          standard: saved.run.standard,
          strictness: saved.run.strictness,
          engine: saved.run.engine,
          judgeModel: saved.run.judge?.model ?? "",
          stale: saved.mapFingerprint !== currentFingerprint
        });
      } catch {
        // A damaged run must not hide healthy history.
      }
    }
    return summaries.sort((a, b) => b.savedAt - a.savedAt);
  }

  async delete(debateId: string, runId: string): Promise<void> {
    let file: string;
    try {
      file = this.file(debateId, runId);
    } catch {
      return;
    }
    await this.enqueue(() => fsp.rm(file, { force: true }));
  }

  async deleteForDebate(debateId: string): Promise<void> {
    let dir: string;
    try {
      dir = this.debateDir(debateId);
    } catch {
      return;
    }
    await this.enqueue(() => fsp.rm(dir, { recursive: true, force: true }));
  }
}
