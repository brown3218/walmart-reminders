import { openPersistentWalmartSession } from "./reorderCatalog.js";

export type RemoveFromCartResult =
  | { status: "removed"; message: string }
  | { status: "needs_manual_action"; message: string }
  | { status: "not_found"; message: string }
  | { status: "failed"; message: string };

export async function removeApprovedItemFromCart(
  profileDir: string,
  target: { title: string; url: string | null }
): Promise<RemoveFromCartResult> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto("https://www.walmart.com/cart", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText({ timeout: 7000 });
    if (/captcha|verify|sign in|log in|two-step|security check|press and hold/i.test(body)) {
      return { status: "needs_manual_action", message: "Walmart requires manual login or verification before cart removal." };
    }

    const titleTerms = target.title
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2)
      .slice(0, 4);
    const cards = page.locator("[data-testid], article, div").filter({ hasText: titleTerms[0] ?? target.title });
    const count = Math.min(await cards.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const text = (await card.innerText({ timeout: 1000 }).catch(() => "")).toLowerCase();
      if (!titleTerms.every((term) => text.includes(term))) continue;
      const removeButton = card
        .getByRole("button", { name: /remove|delete/i })
        .or(card.locator('button:has-text("Remove")'))
        .first();
      if (!(await removeButton.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await removeButton.click();
      await page.waitForTimeout(1000);
      return { status: "removed", message: "Clicked Walmart cart remove button." };
    }

    return { status: "not_found", message: "No matching Walmart cart item was found for removal." };
  } finally {
    await context.close();
  }
}
