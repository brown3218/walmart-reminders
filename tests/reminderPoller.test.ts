import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readReminderSnapshot, startReminderPoller } from "../src/reminders/poller.js";

describe("Reminder poller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not overlap reminder reads when Apple Reminders is slow", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const timer = startReminderPoller({
      db: {} as never,
      config: { reminders: { pollSeconds: 1 } } as never,
      logger: { info: () => undefined, warn: () => undefined } as never,
      pollOnce: async () => {
        calls += 1;
        if (calls === 1) await firstCanFinish;
        return { ingested: 0, skipped: 0, cartRemovals: [] };
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toBe(1);

    finishFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);

    clearInterval(timer);
  });

  it("falls back to AppleScript when built Swift reminderctl cannot read reminders", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "walmart-reminder-poller-"));
    const helperPath = path.join(projectRoot, "apps/reminder-watcher-swift/.build/debug/reminderctl");
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, "#!/bin/sh\n", "utf8");

    const result = await readReminderSnapshot(
      { reminders: { listNames: ["Walmart"] } } as never,
      {
        projectRoot,
        execFile: async (command) => {
          if (command === helperPath) throw new Error("Swift reminderctl failed");
          return { stdout: "r1\tlist-1\tWalmart\tMilk\t\tfalse\n" };
        }
      }
    );

    expect(result).toMatchObject({
      reminders: [{ externalId: "r1", listId: "list-1", listName: "Walmart", title: "Milk", completed: false }],
      skipped: 0,
      helper: "applescript"
    });
  });
});
