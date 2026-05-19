import { openPersistentWalmartSession } from "./reorderCatalog.js";
import { detectWalmartManualAction, walmartManualActionMessage } from "./manualAction.js";

export type AddToCartResult =
  | { status: "added"; message: string }
  | { status: "needs_manual_action"; message: string }
  | { status: "failed"; message: string };

export async function addApprovedItemToCart(profileDir: string, productUrl: string): Promise<AddToCartResult> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText({ timeout: 5000 });
    if (detectWalmartManualAction(body)) {
      return { status: "needs_manual_action", message: walmartManualActionMessage("cart_add") };
    }

    const addButton = page
      .getByRole("button", { name: /add|add to cart/i })
      .or(page.locator('button:has-text("Add")'))
      .first();
    if (!(await addButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      return { status: "failed", message: "No visible Add button was found." };
    }

    await addButton.click();
    await page.waitForTimeout(2500);
    return { status: "added", message: "Clicked Walmart add button; verify cart if needed." };
  } finally {
    await context.close();
  }
}
