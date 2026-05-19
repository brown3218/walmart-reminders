import { describe, expect, it } from "vitest";
import { runExclusiveWalmartProfileTask } from "../src/walmart/profileQueue.js";

describe("Walmart profile queue", () => {
  it("serializes profile tasks so only one persistent browser profile is active at a time", async () => {
    const events: string[] = [];
    let finishFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });

    const first = runExclusiveWalmartProfileTask(async () => {
      events.push("first-start");
      await firstCanFinish;
      events.push("first-end");
      return "first";
    });
    const second = runExclusiveWalmartProfileTask(async () => {
      events.push("second-start");
      return "second";
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);

    finishFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });
});
