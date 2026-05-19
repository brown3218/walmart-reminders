import { describe, expect, it } from "vitest";
import { clickAddToCartOnPage } from "../src/walmart/addToCart.js";

describe("Walmart add-to-cart page workflow", () => {
  it("marks unavailable product pages as failed before looking for an Add button", async () => {
    let buttonChecked = false;
    const page = {
      waitForTimeout: async () => undefined,
      locator: (selector: string) =>
        selector === "body"
          ? {
              innerText: async () => "This item is out of stock and currently unavailable."
            }
          : {
              first: () => ({
                isVisible: async () => {
                  buttonChecked = true;
                  return false;
                },
                click: async () => undefined
              })
            },
      getByRole: () => ({
        or: (locator: unknown) => locator
      })
    };

    await expect(clickAddToCartOnPage(page as never, { productUrl: "https://www.walmart.com/ip/milk/123", quantity: null })).resolves.toEqual({
      status: "failed",
      message: "Walmart says this item is unavailable or out of stock."
    });
    expect(buttonChecked).toBe(false);
  });

  it("stops for manual action if Walmart shows a human check after clicking Add", async () => {
    let clicks = 0;
    const addButton = {
      isVisible: async () => true,
      click: async () => {
        clicks += 1;
      }
    };
    const locatorChain = {
      or: () => ({
        first: () => addButton
      })
    };
    const page = {
      waitForTimeout: async () => undefined,
      locator: (selector: string) =>
        selector === "body"
          ? {
              innerText: async () => (clicks === 0 ? "Product page" : "Are you human?")
            }
          : locatorChain,
      getByRole: () => locatorChain
    };

    await expect(clickAddToCartOnPage(page as never, { productUrl: "https://www.walmart.com/ip/milk/123", quantity: null })).resolves.toEqual({
      status: "needs_manual_action",
      message: "Walmart requires manual login or verification before add to cart can continue."
    });
  });
});
