import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/database.js";
import { runWalmartCatalogSync, runWalmartOrderSync } from "../src/walmart/sync.js";
import type { AppConfig } from "../src/config/config.js";

const config = {
  walmart: {
    profileDir: "./var/walmart-profile",
    autoAddThreshold: 0.99,
    proposeThreshold: 0.45
  }
} as AppConfig;
const logger = { warn: () => undefined, info: () => undefined } as never;

function profileQueue() {
  return {
    lockPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "walmart-sync-lock-")), "profile.lock"),
    waitMs: 5,
    timeoutMs: 200
  };
}

describe("Walmart sync services", () => {
  it("syncs catalog candidates and matches pending reminders", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "ranch mix", notes: null, completed: false });

    const result = await runWalmartCatalogSync({
      db,
      config,
      logger,
      scrape: async () => [
        {
          title: "Hidden Valley Ranch Mix",
          normalizedTitle: "hidden valley ranch mix",
          url: "https://www.walmart.com/ip/ranch/123",
          imageUrl: "https://example.test/ranch.jpg",
          priceText: "$1.98"
        }
      ],
      enqueueAdd: () => undefined,
      profileQueue: profileQueue()
    });

    expect(result).toMatchObject({ candidates: 1, matches: { needsReview: 1 } });
    expect(db.raw.prepare("select status, error_message from walmart_session_state where id = 1").get()).toEqual({
      status: "ready",
      error_message: "Captured 1 Walmart catalog items."
    });
    expect(db.listItems()[0]).toMatchObject({
      raw_text: "ranch mix",
      status: "needs_review",
      candidate_title: "Hidden Valley Ranch Mix"
    });
  });

  it("preserves favorites as a catalog source for safer auto-add decisions", async () => {
    const db = createDatabase(":memory:");

    await runWalmartCatalogSync({
      db,
      config,
      logger,
      scrape: async () => [
        {
          title: "Favorite Yogurt",
          normalizedTitle: "favorite yogurt",
          url: "https://www.walmart.com/ip/yogurt/123",
          imageUrl: "https://example.test/yogurt.jpg",
          priceText: "$3.48",
          source: "favorites"
        }
      ],
      enqueueAdd: () => undefined,
      profileQueue: profileQueue()
    });

    expect(db.raw.prepare("select source from walmart_catalog_items where url = ?").get("https://www.walmart.com/ip/yogurt/123")).toEqual({
      source: "favorites"
    });
  });

  it("syncs orders, fulfills matches, and applies reminder disposition", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r2", listId: "walmart", title: "eggs", notes: null, completed: false });
    const item = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/eggs/123",
      title: "Great Value Large White Eggs, 18 Count",
      chosenBy: "dashboard"
    });
    db.markItemAdded(Number(item.id), "Added from test.");
    const dispositions: string[] = [];

    const result = await runWalmartOrderSync({
      db,
      config,
      logger,
      scrape: async () => [
        {
          orderId: "order-2",
          placedAt: "2026-05-19T10:00:00.000Z",
          status: "placed",
          items: [{ title: "Great Value Large White Eggs 18 Count", url: "https://www.walmart.com/ip/eggs/123" }]
        }
      ],
      applyReminderDispositions: async ({ fulfilled }) => {
        dispositions.push(...fulfilled.map((match) => match.reminder?.externalId).filter(Boolean) as string[]);
      },
      profileQueue: profileQueue()
    });

    expect(result).toMatchObject({ orders: 1, fulfilled: [{ itemId: Number(item.id), orderId: "order-2" }] });
    expect(dispositions).toEqual(["r2"]);
    expect(db.listItems()).toEqual([]);
  });

  it("serializes concurrent catalog and order scrapers through the shared profile queue", async () => {
    const db = createDatabase(":memory:");
    const events: string[] = [];
    let finishCatalog!: () => void;
    const queueOptions = profileQueue();
    const catalogCanFinish = new Promise<void>((resolve) => {
      finishCatalog = resolve;
    });

    const catalog = runWalmartCatalogSync({
      db,
      config,
      logger,
      scrape: async () => {
        events.push("catalog-start");
        await catalogCanFinish;
        events.push("catalog-end");
        return [];
      },
      enqueueAdd: () => undefined,
      profileQueue: queueOptions
    });
    const orders = runWalmartOrderSync({
      db,
      config,
      logger,
      scrape: async () => {
        events.push("orders-start");
        return [];
      },
      applyReminderDispositions: async () => undefined,
      profileQueue: queueOptions
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["catalog-start"]);

    finishCatalog();
    await Promise.all([catalog, orders]);
    expect(events).toEqual(["catalog-start", "catalog-end", "orders-start"]);
  });
});
