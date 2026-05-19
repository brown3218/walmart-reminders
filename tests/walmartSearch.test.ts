import { describe, expect, it } from "vitest";
import { buildSearchCandidates } from "../src/walmart/search.js";

describe("Walmart search candidate mapping", () => {
  it("preserves product IDs from Walmart product URLs", () => {
    const candidates = buildSearchCandidates("yogurt", [
      {
        title: "Great Value Original Lowfat Yogurt",
        url: "https://www.walmart.com/ip/Great-Value-Yogurt/123456?from=/search",
        priceText: "$3.24",
        imageUrl: "https://example.test/yogurt.jpg"
      }
    ]);

    expect(candidates[0]).toMatchObject({
      walmartProductId: "123456",
      title: "Great Value Original Lowfat Yogurt",
      url: "https://www.walmart.com/ip/Great-Value-Yogurt/123456?from=/search",
      priceText: "$3.24",
      imageUrl: "https://example.test/yogurt.jpg",
      source: "walmart_search"
    });
  });
});
