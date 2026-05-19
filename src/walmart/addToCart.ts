import type { Page } from "@playwright/test";
import { openPersistentWalmartSession } from "./reorderCatalog.js";
import { detectWalmartManualAction, walmartManualActionMessage } from "./manualAction.js";

export type AddToCartResult =
  | { status: "added"; message: string }
  | { status: "needs_manual_action"; message: string }
  | { status: "failed"; message: string };

export type AddToCartTarget = {
  productUrl: string;
  quantity: number | null;
};

type QuantityPage = Pick<Page, "getByRole">;
type AddToCartPage = Pick<Page, "getByRole" | "locator" | "waitForTimeout">;

export async function addApprovedItemToCart(profileDir: string, target: AddToCartTarget): Promise<AddToCartResult> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(target.productUrl, { waitUntil: "domcontentloaded" });
    return clickAddToCartOnPage(page, target);
  } finally {
    await context.close();
  }
}

export async function clickAddToCartOnPage(page: AddToCartPage, target: AddToCartTarget): Promise<AddToCartResult> {
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText?.({ timeout: 5000 });
  if (body && detectWalmartManualAction(body)) {
    return { status: "needs_manual_action", message: walmartManualActionMessage("cart_add") };
  }

  const roleButton = page.getByRole("button", { name: /add|add to cart/i });
  const addButton = roleButton.or(page.locator('button:has-text("Add")')).first();
  if (!(await addButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { status: "failed", message: "No visible Add button was found." };
  }

  await addButton.click();
  await page.waitForTimeout(2500);
  const afterAddBody = await page.locator("body").innerText?.({ timeout: 5000 });
  if (afterAddBody && detectWalmartManualAction(afterAddBody)) {
    return { status: "needs_manual_action", message: walmartManualActionMessage("cart_add") };
  }
  await setRequestedQuantity(page, target.quantity);
  return { status: "added", message: "Clicked Walmart add button; verify cart if needed." };
}

async function setRequestedQuantity(
  page: QuantityPage,
  quantity: number | null
): Promise<void> {
  const requested = normalizeRequestedQuantity(quantity);
  if (requested <= 1) return;

  const increaseButton = page
    .getByRole("button", { name: /increase|increment|add one|plus|\+/i })
    .first();
  for (let index = 1; index < requested; index += 1) {
    if (!(await increaseButton.isVisible({ timeout: 1500 }).catch(() => false))) return;
    await increaseButton.click();
  }
}

export function normalizeRequestedQuantity(quantity: number | null): number {
  if (!quantity || !Number.isFinite(quantity)) return 1;
  return Math.max(1, Math.min(12, Math.floor(quantity)));
}
