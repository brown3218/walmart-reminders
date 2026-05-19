import fs from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardHtml = fs.readFileSync("public/index.html", "utf8");

describe("dashboard markup", () => {
  it("uses PNG PWA and Apple touch icons for iPhone Home Screen compatibility", () => {
    const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8")) as {
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(dashboardHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(fs.existsSync("public/apple-touch-icon.png")).toBe(true);
    expect(
      manifest.icons.map((icon) => ({
        src: icon.src,
        sizes: icon.sizes,
        type: icon.type
      }))
    ).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]);
    for (const icon of manifest.icons) {
      expect(fs.existsSync(`public${icon.src}`)).toBe(true);
    }
  });

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

  it("subscribes to server-sent dashboard events with a polling fallback", () => {
    expect(dashboardHtml).toContain("new EventSource(`/api/events?pin=${encodeURIComponent(pinInput.value)}`)");
    expect(dashboardHtml).toContain('events.addEventListener("status"');
    expect(dashboardHtml).toContain("events.onerror = () =>");
    expect(dashboardHtml).toContain("setInterval(load, 6000)");
  });

  it("shows Walmart cart and order status in the header tiles", () => {
    expect(dashboardHtml).toContain('id="cartStatus"');
    expect(dashboardHtml).toContain('cartLabel(status.counts)');
    expect(dashboardHtml).toContain('id="ordersStatus"');
    expect(dashboardHtml).toContain('syncLabel(syncRows, "walmart_orders")');
  });

  it("renders automation activity from the history API", () => {
    expect(dashboardHtml).toContain("history.activity || history.items || []");
    expect(dashboardHtml).toContain("activityRow");
    expect(dashboardHtml).toContain("item.type === \"automation\"");
  });

  it("uses explicit proposal action labels from the phone workflow", () => {
    expect(dashboardHtml).toContain('id="searchAlternatives">Search alternatives</button>');
    expect(dashboardHtml).toContain('id="openCandidate">Open Walmart</button>');
  });
});
