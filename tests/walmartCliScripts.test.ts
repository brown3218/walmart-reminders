import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Walmart CLI sync scripts", () => {
  it("uses the shared catalog sync service", () => {
    const source = fs.readFileSync("scripts/sync-walmart-catalog.ts", "utf8");

    expect(source).toContain("runWalmartCatalogSync");
    expect(source).not.toContain("scrapeReorderCandidates");
  });

  it("uses the shared order sync service so reminder cleanup behavior stays consistent", () => {
    const source = fs.readFileSync("scripts/sync-walmart-orders.ts", "utf8");

    expect(source).toContain("runWalmartOrderSync");
    expect(source).not.toContain("scrapeRecentOrders");
    expect(source).not.toContain("db.reconcileOrders()");
  });
});
