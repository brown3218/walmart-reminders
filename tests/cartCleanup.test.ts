import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { applyReminderSnapshot } from "../src/reminders/snapshot.js";
import { removeMatchedItemFromWalmart } from "../src/walmart/automation.js";
import type { AppConfig } from "../src/config/config.js";

const config = { walmart: { profileDir: "./var/walmart-profile" } } as AppConfig;
const logger = { warn: () => undefined } as never;

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

  it("returns the old cart target when an added reminder is edited to a new item", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r4", listId: "walmart", title: "milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");

    const result = applyReminderSnapshot(db, [
      { externalId: "r4", listId: "walmart", title: "eggs", notes: null, completed: false }
    ]);

    expect(result).toMatchObject({ updated: 1 });
    expect(result.cartRemovals).toEqual([
      expect.objectContaining({
        itemId: Number(item.id),
        externalId: "r4",
        needsCartRemoval: true,
        productTitle: "Usual Milk",
        productUrl: "https://www.walmart.com/ip/milk/123"
      })
    ]);
    expect(db.listItems()[0]).toMatchObject({
      raw_text: "eggs",
      status: "parsed",
      chosen_title: null
    });
  });

  it("uses a captured cart-removal target after the item has been rematched", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r5", listId: "walmart", title: "milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");
    db.upsertReminder({ externalId: "r5", listId: "walmart", title: "eggs", notes: null, completed: false });

    let removedTarget: { title: string; url: string | null } | null = null;
    await removeMatchedItemFromWalmart(db, config, logger, Number(item.id), {
      target: { title: "Usual Milk", url: "https://www.walmart.com/ip/milk/123" },
      runExclusive: async (task) => task(),
      removeFromCart: async (_profileDir, target) => {
        removedTarget = target;
        return { status: "removed", message: "Removed from test." };
      }
    });

    expect(removedTarget).toEqual({ title: "Usual Milk", url: "https://www.walmart.com/ip/milk/123" });
    expect(db.listItems()[0]).toMatchObject({ raw_text: "eggs", cart_status: "removed" });
  });
});
