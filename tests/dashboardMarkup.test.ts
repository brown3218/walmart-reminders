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
});
