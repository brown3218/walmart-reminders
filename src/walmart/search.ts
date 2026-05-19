import { normalizeText } from "../parser/groceryParser.js";
import { openPersistentWalmartSession } from "./reorderCatalog.js";
import type { ProductCandidateInput } from "../db/database.js";

export async function searchWalmartProducts(profileDir: string, query: string): Promise<ProductCandidateInput[]> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    const url = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const body = await page.locator("body").innerText({ timeout: 5000 });
    if (/captcha|verify|sign in|log in|two-step|security check/i.test(body)) {
      throw new Error("Walmart requires manual login or verification before search can continue.");
    }

    const raw = await page.locator('a[href*="/ip/"]').evaluateAll((anchors) =>
      anchors
        .map((anchor) => {
          const element = anchor as HTMLAnchorElement;
          const card = element.closest("[data-item-id], article, div");
          const title = element.innerText.trim() || card?.textContent?.trim().split("\n")[0] || "";
          const url = element.href;
          const priceText = card?.textContent?.match(/\$\d+(?:\.\d{2})?/)?.[0] ?? null;
          const imageUrl = card?.querySelector("img")?.getAttribute("src") ?? null;
          return { title, url, priceText, imageUrl };
        })
        .filter((item) => item.title.length > 3 && item.url.includes("/ip/"))
    );

    const seen = new Set<string>();
    const candidates: ProductCandidateInput[] = [];
    for (const item of raw) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      candidates.push({
        title: item.title.replace(/\s+/g, " ").trim(),
        url: item.url,
        priceText: item.priceText,
        sizeText: null,
        availabilityText: null,
        imageUrl: item.imageUrl,
        confidence: scoreSearchResult(query, item.title),
        source: "walmart_search"
      });
      if (candidates.length >= 5) break;
    }
    return candidates;
  } finally {
    await context.close();
  }
}

function scoreSearchResult(query: string, title: string): number {
  const queryTokens = new Set(normalizeText(query).split(" ").filter(Boolean));
  const titleTokens = new Set(normalizeText(title).split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((token) => titleTokens.has(token)).length;
  return queryTokens.size === 0 ? 0 : Number(Math.min(1, overlap / queryTokens.size).toFixed(2));
}
