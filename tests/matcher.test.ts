import { describe, expect, it } from "vitest";
import { matchAgainstReorderCatalog } from "../src/matching/reorderMatcher.js";
import { parseGroceryText } from "../src/parser/groceryParser.js";

describe("matchAgainstReorderCatalog", () => {
  const catalog = [
    {
      id: 1,
      title: "Great Value Large White Eggs, 18 Count",
      normalizedTitle: "great value large white eggs 18 count",
      url: "https://www.walmart.com/ip/eggs",
      brand: "Great Value",
      sizeText: "18 Count"
    },
    {
      id: 2,
      title: "Diet Coke Soda, 12 fl oz, 12 Pack Cans",
      normalizedTitle: "diet coke soda 12 fl oz 12 pack cans",
      url: "https://www.walmart.com/ip/diet-coke",
      brand: "Diet Coke",
      sizeText: "12 Pack"
    }
  ];

  it("strongly matches known previously ordered branded items", () => {
    const result = matchAgainstReorderCatalog(parseGroceryText("2x Great Value eggs"), catalog);

    expect(result.decision).toBe("auto_add");
    expect(result.bestMatch?.id).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("routes unknown items to review instead of global auto-add", () => {
    const result = matchAgainstReorderCatalog(parseGroceryText("dragon fruit"), catalog);

    expect(result.decision).toBe("needs_review");
    expect(result.reason).toContain("not previously ordered");
  });
});
