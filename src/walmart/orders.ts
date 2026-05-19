import { normalizeText } from "../parser/groceryParser.js";
import { openPersistentWalmartSession } from "./reorderCatalog.js";
import type { OrderInput } from "../db/database.js";

export async function scrapeRecentOrders(profileDir: string): Promise<OrderInput[]> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto("https://www.walmart.com/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const body = await page.locator("body").innerText({ timeout: 7000 });
    if (/captcha|verify|sign in|log in|two-step|security check|press and hold/i.test(body)) {
      throw new Error("Walmart requires manual login or verification before order sync can continue.");
    }

    type ScrapedOrder = {
      orderId: string;
      placedAt: string | null;
      status: string | null;
      items: Array<{
        title: string;
        url?: string | null;
        imageUrl?: string | null;
        priceText?: string | null;
        quantity?: number | null;
      }>;
    };
    const orders = (await page.locator("article, [data-testid*='order'], [data-automation-id*='order'], div").evaluateAll((nodes) => {
      const candidates = nodes
        .map((node, index) => {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          const anchors = [...node.querySelectorAll('a[href*="/ip/"]')] as HTMLAnchorElement[];
          if (anchors.length === 0 || !/order|placed|delivered|pickup|purchase/i.test(text)) return null;
          const orderId = text.match(/order\s*#?\s*([A-Z0-9-]{6,})/i)?.[1] ?? `scraped-${index}`;
          const placedText = text.match(/(?:placed|ordered|delivered)\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i)?.[1] ?? null;
          const items = anchors
            .map((anchor) => {
              const card = anchor.closest("[data-testid], article, div");
              const title = anchor.textContent?.replace(/\s+/g, " ").trim() || card?.textContent?.trim().split(/\n/)[0] || "";
              if (title.length < 3) return null;
              return {
                title,
                url: anchor.href,
                imageUrl: card?.querySelector("img")?.getAttribute("src") ?? null,
                priceText: card?.textContent?.match(/\$\d+(?:\.\d{2})?/)?.[0] ?? null,
                quantity: null
              };
            })
            .filter(Boolean);
          return {
            orderId,
            placedAt: placedText ? new Date(placedText).toISOString() : null,
            status: /delivered/i.test(text) ? "delivered" : "placed",
            items
          };
        })
        .filter(Boolean);

      const byId = new Map();
      for (const candidate of candidates) {
        if (!candidate || byId.has(candidate.orderId)) continue;
        byId.set(candidate.orderId, candidate);
      }
      return [...byId.values()];
    })) as ScrapedOrder[];

    return orders
      .map((order) => ({
        orderId: String(order.orderId),
        placedAt: order.placedAt ? String(order.placedAt) : null,
        status: order.status ? String(order.status) : null,
        items: order.items
          .map((item: { title: string; url?: string | null; imageUrl?: string | null; priceText?: string | null; quantity?: number | null }) => ({
            productId: extractProductId(item.url ?? null),
            title: item.title,
            url: item.url ?? null,
            imageUrl: item.imageUrl ?? null,
            priceText: item.priceText ?? null,
            quantity: item.quantity ?? null
          }))
          .filter((item) => normalizeText(item.title).length > 0)
      }))
      .filter((order) => order.items.length > 0)
      .slice(0, 20);
  } finally {
    await context.close();
  }
}

function extractProductId(url: string | null): string | null {
  if (!url) return null;
  return url.match(/\/ip\/(?:[^/]+\/)?(\d+)/)?.[1] ?? null;
}
