import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { replaceFile, type AtomicFileOps } from "./atomic-write";

let dir = "";
let target = "";
let tmp = "";

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-atomic-"));
  target = path.join(dir, "debate.json");
  tmp = path.join(dir, "debate.json.tmp");
  await fsp.writeFile(target, "original", "utf8");
  await fsp.writeFile(tmp, "replacement", "utf8");
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

function lockedError(): NodeJS.ErrnoException {
  const error = new Error("file is locked") as NodeJS.ErrnoException;
  error.code = "EPERM";
  return error;
}

describe("atomic file replacement", () => {
  it("replaces a file normally", async () => {
    await replaceFile(tmp, target);
    expect(await fsp.readFile(target, "utf8")).toBe("replacement");
  });

  it("never deletes the live file when the replacement fails", async () => {
    const ops: AtomicFileOps = {
      async rename(from, to) {
        if (from === tmp && to === target) throw lockedError();
        await fsp.rename(from, to);
      },
      access: (file) => fsp.access(file),
      rm: (file, options) => fsp.rm(file, options)
    };

    await expect(replaceFile(tmp, target, ops)).rejects.toThrow("file is locked");
    expect(await fsp.readFile(target, "utf8")).toBe("original");
    expect(await fsp.readFile(tmp, "utf8")).toBe("replacement");
  });

  it("uses a backup when a lock clears after the old file is moved aside", async () => {
    let backedUp = false;
    const ops: AtomicFileOps = {
      async rename(from, to) {
        if (from === target && to.endsWith(".bak")) {
          backedUp = true;
          await fsp.rename(from, to);
          return;
        }
        if (from === tmp && to === target && !backedUp) throw lockedError();
        await fsp.rename(from, to);
      },
      access: (file) => fsp.access(file),
      rm: (file, options) => fsp.rm(file, options)
    };

    await replaceFile(tmp, target, ops);
    expect(await fsp.readFile(target, "utf8")).toBe("replacement");
    expect((await fsp.readdir(dir)).some((name) => name.endsWith(".bak"))).toBe(false);
  });

  it("preserves the old content in a backup if restoring it fails", async () => {
    let backup = "";
    const ops: AtomicFileOps = {
      async rename(from, to) {
        if (from === tmp && to === target) throw lockedError();
        if (from === target && to.endsWith(".bak")) {
          backup = to;
          await fsp.rename(from, to);
          return;
        }
        if (from === backup && to === target) throw new Error("restore failed");
        await fsp.rename(from, to);
      },
      access: (file) => fsp.access(file),
      rm: (file, options) => fsp.rm(file, options)
    };

    await expect(replaceFile(tmp, target, ops)).rejects.toThrow("preserved at");
    expect(backup).not.toBe("");
    expect(await fsp.readFile(backup, "utf8")).toBe("original");
  });
});
