import { chromium, type BrowserContext } from "@playwright/test";
import { normalizeText } from "../parser/groceryParser.js";
import { detectWalmartManualAction, walmartManualActionMessage } from "./manualAction.js";

export type WalmartReorderCandidate = {
  title: string;
  normalizedTitle: string;
  url: string;
  priceText: string | null;
  imageUrl: string | null;
};

export async function openPersistentWalmartSession(profileDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 }
  });
}

export async function scrapeReorderCandidates(profileDir: string): Promise<WalmartReorderCandidate[]> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto("https://www.walmart.com/my-items/reorder", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    if (detectWalmartManualAction(await page.locator("body").innerText({ timeout: 5000 }))) {
      throw new Error(walmartManualActionMessage("catalog"));
    }

    const links = await page.locator('a[href*="/ip/"]').evaluateAll((anchors) =>
      anchors
        .map((anchor) => {
          const element = anchor as HTMLAnchorElement;
          const title = element.innerText.trim();
          const url = element.href;
          const card = element.closest("[data-item-id], article, div");
          const priceText = card?.textContent?.match(/\$\d+(?:\.\d{2})?/)?.[0] ?? null;
          const imageUrl = card?.querySelector("img")?.getAttribute("src") ?? null;
          return { title, url, priceText, imageUrl };
        })
        .filter((item) => item.title.length > 3 && item.url.includes("/ip/"))
    );

    const deduped = new Map<string, WalmartReorderCandidate>();
    for (const link of links) {
      deduped.set(link.url, {
        ...link,
        normalizedTitle: normalizeText(link.title)
      });
    }
    return [...deduped.values()];
  } finally {
    await context.close();
  }
}
