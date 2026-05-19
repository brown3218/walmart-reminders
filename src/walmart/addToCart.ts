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

type QuantityButton = {
  isVisible: (options: { timeout: number }) => Promise<boolean>;
  click: () => Promise<void>;
};

type QuantityPage = {
  getByRole: (role: "button", options: { name: RegExp }) => { first: () => QuantityButton };
};

export async function addApprovedItemToCart(profileDir: string, target: AddToCartTarget): Promise<AddToCartResult> {
  const context = await openPersistentWalmartSession(profileDir);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(target.productUrl, { waitUntil: "domcontentloaded" });
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
    await setRequestedQuantity(page, target.quantity);
    return { status: "added", message: "Clicked Walmart add button; verify cart if needed." };
  } finally {
    await context.close();
  }
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
