import fs from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardHtml = fs.readFileSync("public/index.html", "utf8");

describe("dashboard markup", () => {
  it("exposes the expected item cleanup actions in the review modal", () => {
    for (const id of ["markAdded", "retryItem", "markOrdered", "deleteItem"]) {
      expect(dashboardHtml).toContain(`id="${id}"`);
      expect(dashboardHtml).toContain(`querySelector("#${id}")`);
    }
  });

  it("sync now triggers Reminders, catalog, and orders sync endpoints", () => {
    expect(dashboardHtml).toContain('"/api/sync/reminders"');
    expect(dashboardHtml).toContain('"/api/sync/walmart-catalog"');
    expect(dashboardHtml).toContain('"/api/sync/orders"');
  });

  it("shows Walmart order sync status in the header tiles", () => {
    expect(dashboardHtml).toContain('id="ordersStatus"');
    expect(dashboardHtml).toContain('syncLabel(syncRows, "walmart_orders")');
  });

  it("uses explicit proposal action labels from the phone workflow", () => {
    expect(dashboardHtml).toContain('id="searchAlternatives">Search alternatives</button>');
    expect(dashboardHtml).toContain('id="openCandidate">Open Walmart</button>');
  });
});
