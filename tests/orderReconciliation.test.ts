import { describe, expect, it } from "vitest";
import { findFulfilledItems } from "../src/orders/reconciliation.js";

describe("order reconciliation", () => {
  it("matches recently ordered items by product URL and title similarity", () => {
    const fulfilled = findFulfilledItems(
      [
        {
          itemId: 7,
          status: "added_to_cart",
          productUrl: "https://www.walmart.com/ip/eggs/123",
          productTitle: "Great Value Large White Eggs, 18 Count"
        },
        {
          itemId: 8,
          status: "needs_review",
          productUrl: null,
          productTitle: "Dragon Fruit"
        }
      ],
      [
        {
          orderId: "o1",
          placedAt: "2026-05-19T10:00:00.000Z",
          items: [{ title: "Great Value Large White Eggs 18 Count", url: "https://www.walmart.com/ip/eggs/123" }]
        }
      ]
    );

    expect(fulfilled).toEqual([{ itemId: 7, orderId: "o1", reason: "product_url" }]);
  });
});
