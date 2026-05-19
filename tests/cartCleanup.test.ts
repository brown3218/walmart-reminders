import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { applyReminderSnapshot } from "../src/reminders/snapshot.js";

describe("cart cleanup on deletion", () => {
  it("records manual cart-removal action when an added item is deleted", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");

    const deletion = db.deleteItem(Number(item.id), "dashboard");
    const deleted = db.listItems({ includeInactive: true })[0];
    const run = db.raw
      .prepare("select action, status, error_message from automation_runs where grocery_item_id = ? order by id desc limit 1")
      .get(item.id);

    expect(deletion).toMatchObject({ externalId: "r1", action: "complete", needsCartRemoval: true });
    expect(deleted).toMatchObject({
      status: "deleted",
      cart_status: "manual_action",
      error_message: "Item was removed locally; remove it from the Walmart cart if it is still present."
    });
    expect(run).toMatchObject({ action: "remove_from_cart", status: "manual_action" });
  });

  it("returns cart-removal work when an added item disappears from Apple Reminders", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r2", listId: "walmart", title: "milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");

    const result = applyReminderSnapshot(db, []);

    expect(result.cartRemovals).toEqual([
      expect.objectContaining({ itemId: Number(item.id), externalId: "r2", needsCartRemoval: true })
    ]);
  });

  it("returns cart-removal work when an added item is completed in Apple Reminders", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r3", listId: "walmart", title: "deodorant", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/deodorant/123",
      title: "Usual Deodorant",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");

    const result = applyReminderSnapshot(db, [
      { externalId: "r3", listId: "walmart", title: "deodorant", notes: null, completed: true }
    ]);

    expect(result).toMatchObject({ completed: 1 });
    expect(result.cartRemovals).toEqual([
      expect.objectContaining({ itemId: Number(item.id), externalId: "r3", needsCartRemoval: true })
    ]);
  });
});
