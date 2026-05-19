import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runExclusiveWalmartProfileTask } from "../src/walmart/profileQueue.js";

describe("Walmart profile queue", () => {
  function makeLockPath(): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "walmart-profile-lock-")), "profile.lock");
  }

  it("serializes profile tasks so only one persistent browser profile is active at a time", async () => {
    const lockPath = makeLockPath();
    const events: string[] = [];
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const first = runExclusiveWalmartProfileTask(
      async () => {
        events.push("first-start");
        await firstCanFinish;
        events.push("first-end");
        return "first";
      },
      { lockPath, waitMs: 5, timeoutMs: 200 }
    );
    const second = runExclusiveWalmartProfileTask(
      async () => {
        events.push("second-start");
        return "second";
      },
      { lockPath, waitMs: 5, timeoutMs: 200 }
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["first-start"]);

    finishFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("creates and removes a file lock for cross-process profile operations", async () => {
    const lockPath = makeLockPath();

    await runExclusiveWalmartProfileTask(
      async () => {
        expect(fs.existsSync(lockPath)).toBe(true);
      },
      { lockPath, waitMs: 10, timeoutMs: 200 }
    );

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("times out when another process holds the profile lock", async () => {
    const lockPath = makeLockPath();
    fs.writeFileSync(lockPath, "held elsewhere", "utf8");

    await expect(
      runExclusiveWalmartProfileTask(async () => undefined, { lockPath, waitMs: 5, timeoutMs: 20 })
    ).rejects.toThrow("Timed out waiting for Walmart profile lock");

    fs.rmSync(lockPath, { force: true });
  });

  it("clears a stale lock when the recorded process no longer exists", async () => {
    const lockPath = makeLockPath();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }), "utf8");

    await expect(
      runExclusiveWalmartProfileTask(async () => "ok", { lockPath, waitMs: 5, timeoutMs: 200 })
    ).resolves.toBe("ok");

    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
