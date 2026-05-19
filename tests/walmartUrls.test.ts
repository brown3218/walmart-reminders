import { describe, expect, it } from "vitest";
import { extractWalmartProductId, isWalmartProductUrl } from "../src/walmart/urls.js";

describe("Walmart product URLs", () => {
  it("recognizes product pages and extracts stable numeric product IDs", () => {
    expect(isWalmartProductUrl("https://www.walmart.com/ip/Hidden-Valley-Ranch/123456789?athbdg=L1100")).toBe(true);
    expect(extractWalmartProductId("https://www.walmart.com/ip/Hidden-Valley-Ranch/123456789?athbdg=L1100")).toBe(
      "123456789"
    );
    expect(extractWalmartProductId("https://www.walmart.com/ip/123456789")).toBe("123456789");
    expect(extractWalmartProductId("https://www.walmart.com/search?q=ranch")).toBeNull();
  });
});
