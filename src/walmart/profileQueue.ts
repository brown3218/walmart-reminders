import fs from "node:fs/promises";
import path from "node:path";

let queue = Promise.resolve();

export type WalmartProfileQueueOptions = {
  lockPath?: string;
  waitMs?: number;
  timeoutMs?: number;
};

export function runExclusiveWalmartProfileTask<T>(
  task: () => Promise<T>,
  options: WalmartProfileQueueOptions = {}
): Promise<T> {
  const run = queue.catch(() => undefined).then(() => runWithFileLock(task, options));
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function runWithFileLock<T>(task: () => Promise<T>, options: WalmartProfileQueueOptions): Promise<T> {
  const lockPath = options.lockPath ?? path.resolve(process.cwd(), "var", "walmart-profile.lock");
  const waitMs = options.waitMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  let handle: fs.FileHandle | null = null;

  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        handle = null;
        throw error;
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (await removeLockIfOwnerIsGone(lockPath)) {
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for Walmart profile lock at ${lockPath}.`);
      }
      await sleep(waitMs);
    }
  }

  try {
    return await task();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function removeLockIfOwnerIsGone(lockPath: string): Promise<boolean> {
  const lock = await readLock(lockPath);
  if (!lock?.pid || isProcessAlive(lock.pid)) {
    return false;
  }
  await fs.rm(lockPath, { force: true });
  return true;
}

async function readLock(lockPath: string): Promise<{ pid?: number } | null> {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: unknown };
    return typeof lock.pid === "number" ? { pid: lock.pid } : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isProcessMissing(error);
  }
}

function isProcessMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
