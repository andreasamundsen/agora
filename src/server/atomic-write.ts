import fsp from "node:fs/promises";

const RETRY_DELAYS_MS = [0, 75, 200];
const RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);

export interface AtomicFileOps {
  rename(from: string, to: string): Promise<void>;
  access(path: string): Promise<void>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
}

const DEFAULT_OPS: AtomicFileOps = {
  rename: (from, to) => fsp.rename(from, to),
  access: (path) => fsp.access(path),
  rm: (path, options) => fsp.rm(path, options)
};

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return String((error as NodeJS.ErrnoException).code);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replace a live file without ever deleting it until the replacement is safe.
 *
 * A plain rename is atomic where the platform allows it. Windows can refuse to
 * replace a file held by a scanner or another reader; in that case the old
 * file is moved aside, the new file is moved in, and the old file is restored
 * if the second move fails. The old file is never removed first.
 */
export async function replaceFile(
  tmp: string,
  target: string,
  ops: AtomicFileOps = DEFAULT_OPS
): Promise<void> {
  let lastError: unknown;

  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs) await wait(delayMs);
    try {
      await ops.rename(tmp, target);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_CODES.has(errorCode(error) ?? "")) throw error;
    }
  }

  try {
    await ops.access(target);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw lastError;
    throw error;
  }

  const backup = `${target}.${process.pid}.${Date.now().toString(36)}.bak`;
  try {
    await ops.rename(target, backup);
  } catch {
    throw lastError;
  }

  try {
    await ops.rename(tmp, target);
  } catch (error) {
    try {
      await ops.rename(backup, target);
    } catch {
      throw new Error(
        `The new file could not be moved into place, and the previous file could not be restored. The previous file is preserved at ${backup}.`
      );
    }
    throw error;
  }

  await ops.rm(backup, { force: true }).catch(() => undefined);
}
