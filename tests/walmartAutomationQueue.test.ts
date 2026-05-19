import { describe, expect, it } from "vitest";
import { createSerialAutomationQueue } from "../src/walmart/automationQueue.js";

describe("Walmart automation queue", () => {
  it("runs add and remove jobs through one concurrency-1 lane", async () => {
    const queue = createSerialAutomationQueue();
    const events: string[] = [];
    let markFirstStarted!: () => void;
    let finishFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      events.push("add-start");
      markFirstStarted();
      await firstFinished;
      events.push("add-end");
    });
    const second = queue.enqueue(async () => {
      events.push("remove-start");
      events.push("remove-end");
    });

    await firstStarted;
    expect(events).toEqual(["add-start"]);

    finishFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["add-start", "add-end", "remove-start", "remove-end"]);
  });
});
