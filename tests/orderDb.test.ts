import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";

describe("database order reconciliation", () => {
  it("persists Walmart orders and fulfills matching added items", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "eggs", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/eggs/123",
      title: "Great Value Large White Eggs, 18 Count",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");

    const stored = db.upsertOrders([
      {
        orderId: "order-1",
        placedAt: "2026-05-19T10:00:00.000Z",
        status: "placed",
        items: [
          {
            productId: "123",
            title: "Great Value Large White Eggs 18 Count",
            url: "https://www.walmart.com/ip/eggs/123",
            imageUrl: null,
            priceText: "$4.28",
            quantity: 1
          }
        ]
      }
    ]);
    const result = db.reconcileOrders();

    expect(stored).toBe(1);
    expect(result).toEqual([
      {
        itemId: Number(item.id),
        orderId: "order-1",
        reason: "product_url",
        reminder: {
          externalId: "r1",
          action: "complete",
          needsCartRemoval: false,
          itemId: Number(item.id)
        }
      }
    ]);
    expect(db.listItems()).toEqual([]);
    expect(db.listItems({ includeInactive: true })[0]).toMatchObject({ status: "fulfilled" });
  });
});
