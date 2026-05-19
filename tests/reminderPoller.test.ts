import { afterEach, describe, expect, it, vi } from "vitest";
import { startReminderPoller } from "../src/reminders/poller.js";

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
        return { ingested: 0, skipped: 0 };
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
});
