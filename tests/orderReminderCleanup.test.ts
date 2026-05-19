import { describe, expect, it } from "vitest";
import { applyFulfilledReminderDispositions } from "../src/orders/reminderCleanup.js";
import type { AppConfig } from "../src/config/config.js";
import type { ReconciledFulfillment } from "../src/db/database.js";

describe("order reminder cleanup", () => {
  it("applies fulfill disposition for every reconciled reminder", async () => {
    const calls: Array<{ externalId: string; reason: string }> = [];
    const fulfilled: ReconciledFulfillment[] = [
      {
        itemId: 1,
        orderId: "order-1",
        reason: "product_url",
        reminder: { externalId: "r1", action: "complete", needsCartRemoval: false, itemId: 1 }
      },
      {
        itemId: 2,
        orderId: "order-1",
        reason: "title_similarity",
        reminder: null
      }
    ];

    await applyFulfilledReminderDispositions({
      fulfilled,
      config: {} as AppConfig,
      logger: { warn: () => undefined } as never,
      apply: async (_config, _logger, input) => {
        calls.push(input);
      }
    });

    expect(calls).toEqual([{ externalId: "r1", reason: "fulfill" }]);
  });
});
