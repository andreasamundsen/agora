import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Debate, DebateSummary, debateSummary, reconcileDebate } from "../core/model";
import { seedDebates } from "../core/demo";
import { dataDir } from "./settings";

/**
 * One writer per store: every debate file is written through this class,
 * serialized on a single promise chain and swapped into place atomically.
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export class DebateStore {
  private dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir = path.join(dataDir(), "debates")) {
    this.dir = dir;
  }

  get directory(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const marker = path.join(this.dir, ".initialized");
    if (fs.existsSync(marker)) return;
    const existing = await fsp.readdir(this.dir);
    if (!existing.some((file) => file.endsWith(".json"))) {
      for (const debate of seedDebates()) {
        await this.write(debate);
      }
    }
    await fsp.writeFile(marker, new Date().toISOString(), "utf8");
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error("Invalid debate id");
    return path.join(this.dir, `${id}.json`);
  }

  private async read(id: string): Promise<Debate | null> {
    try {
      const raw = await fsp.readFile(this.file(id), "utf8");
      const parsed = JSON.parse(raw) as Debate;
      if (!parsed || !Array.isArray(parsed.nodes) || !parsed.thesisId) return null;
      // Reconcile on read so files edited by hand or produced by an older
      // version still satisfy the current invariants.
      return reconcileDebate(parsed);
    } catch {
      return null;
    }
  }

  async list(): Promise<DebateSummary[]> {
    const files = await fsp.readdir(this.dir).catch(() => [] as string[]);
    const debates: Debate[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const debate = await this.read(file.slice(0, -5));
      if (debate) debates.push(debate);
    }
    return debates
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(debateSummary);
  }

  async get(id: string): Promise<Debate | null> {
    return this.enqueue(() => this.read(id));
  }

  async save(debate: Debate): Promise<Debate> {
    const clean = reconcileDebate({ ...debate, updatedAt: Date.now() });
    await this.write(clean);
    return clean;
  }

  private async write(debate: Debate): Promise<void> {
    const file = this.file(debate.id);
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const body = JSON.stringify(debate, null, 2);
    await this.enqueue(async () => {
      await fsp.writeFile(tmp, body, "utf8");
      try {
        await fsp.rename(tmp, file);
      } catch (error) {
        // Windows can refuse to replace an existing file. Remove and retry.
        await fsp.rm(file, { force: true });
        await fsp.rename(tmp, file);
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.enqueue(async () => {
      await fsp.rm(this.file(id), { force: true });
    });
  }

  async isEmpty(): Promise<boolean> {
    const files = await fsp.readdir(this.dir).catch(() => [] as string[]);
    return !files.some((file) => file.endsWith(".json"));
  }
}
