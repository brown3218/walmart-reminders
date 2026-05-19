import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { addMatchedItemToWalmart } from "../src/walmart/automation.js";
import type { AppConfig } from "../src/config/config.js";
import type { AddToCartTarget } from "../src/walmart/addToCart.js";

describe("Walmart cart automation quantities", () => {
  it("passes parsed reminder quantities to the Walmart add-to-cart adapter", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "3x milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });

    const targets: AddToCartTarget[] = [];
    await addMatchedItemToWalmart(
      db,
      { walmart: { profileDir: "./var/walmart-profile" } } as AppConfig,
      { warn: () => undefined } as never,
      Number(item.id),
      {
        addToCart: async (_profileDir, target) => {
          targets.push(target);
          return { status: "added", message: "Added from test." };
        },
        runExclusive: (task) => task()
      }
    );

    expect(targets).toEqual([{ productUrl: "https://www.walmart.com/ip/milk/123", quantity: 3 }]);
    expect(db.listItems({ includeInactive: true })[0]).toMatchObject({ status: "added_to_cart" });
  });

  it("does not reopen Walmart when a manual verification is already pending", async () => {
    const db = createDatabase(":memory:");
    db.updateWalmartSession("needs_manual_action", "Walmart verification required.", true);
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "milk", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk/123",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });

    let openedProfile = false;
    await addMatchedItemToWalmart(
      db,
      { walmart: { profileDir: "./var/walmart-profile" } } as AppConfig,
      { warn: () => undefined } as never,
      Number(item.id),
      {
        addToCart: async () => {
          openedProfile = true;
          return { status: "added", message: "Added from test." };
        },
        runExclusive: (task) => task()
      }
    );

    expect(openedProfile).toBe(false);
    expect(db.listItems({ includeInactive: true })[0]).toMatchObject({
      status: "manual_action",
      cart_status: "manual_action"
    });
  });
});
