import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Debate, DebateSummary, debateSummary, reconcileDebate } from "../core/model";
import { seedDebates } from "../core/demo";
import { dataDir } from "./settings";
import { replaceFile } from "./atomic-write";

/**
 * One writer per store: every debate file is written through this class,
 * serialized on a single promise chain and swapped into place atomically.
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export class DebateReadError extends Error {
  readonly id: string;

  constructor(id: string, message: string) {
    super(message);
    this.name = "DebateReadError";
    this.id = id;
  }
}

export interface DebateListResult {
  debates: DebateSummary[];
  warnings: string[];
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return String((error as NodeJS.ErrnoException).code);
}

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

  private async read(id: string, onWarning?: (message: string) => void): Promise<Debate | null> {
    let file: string;
    try {
      file = this.file(id);
    } catch (error) {
      throw new DebateReadError(id, "The debate id is invalid.");
    }

    let raw: string;
    try {
      raw = await fsp.readFile(file, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw new DebateReadError(id, "The debate file could not be read.");
    }

    let parsed: Debate;
    try {
      parsed = JSON.parse(raw) as Debate;
    } catch {
      throw new DebateReadError(id, "The debate file is not valid JSON.");
    }
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || !parsed.thesisId) {
      throw new DebateReadError(id, "The debate file is missing its graph.");
    }

    try {
      // Reconcile on read so files edited by hand or produced by an older
      // version still satisfy the current invariants.
      return reconcileDebate(parsed, onWarning);
    } catch {
      throw new DebateReadError(id, "The debate file has an invalid graph.");
    }
  }

  async list(): Promise<DebateListResult> {
    return this.enqueue(() => this.listNow());
  }

  private async listNow(): Promise<DebateListResult> {
    const files = await fsp.readdir(this.dir).catch(() => [] as string[]);
    const debates: Debate[] = [];
    const warnings: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      try {
        const fileWarnings: string[] = [];
        const debate = await this.read(id, (warning) => fileWarnings.push(warning));
        if (debate) {
          debates.push(debate);
          if (fileWarnings.length) warnings.push(`“${id}” was loaded with changes: ${fileWarnings.join(" ")}`);
        }
      } catch (error) {
        const reason = error instanceof DebateReadError ? error.message : "The debate file could not be read.";
        warnings.push(`“${id}” was skipped: ${reason} It was left untouched.`);
      }
    }
    return {
      debates: debates.sort((a, b) => b.updatedAt - a.updatedAt).map(debateSummary),
      warnings
    };
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
      await replaceFile(tmp, file);
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
