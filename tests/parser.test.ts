import { describe, expect, it } from "vitest";
import { parseGroceryText } from "../src/parser/groceryParser.js";

describe("parseGroceryText", () => {
  it("extracts multiplier quantity and keeps brand and product terms", () => {
    expect(parseGroceryText("2x Great Value eggs")).toMatchObject({
      rawText: "2x Great Value eggs",
      normalizedText: "great value eggs",
      quantityValue: 2,
      quantityUnit: "each",
      brandHint: "Great Value",
      productTerms: "eggs"
    });
  });

  it("keeps package notes in the searchable terms", () => {
    expect(parseGroceryText("Diet Coke 12 pack")).toMatchObject({
      normalizedText: "diet coke 12 pack",
      brandHint: "Diet Coke",
      productTerms: "12 pack"
    });
  });

  it("normalizes simple grocery reminders", () => {
    expect(parseGroceryText("strawberries organic")).toMatchObject({
      quantityValue: null,
      brandHint: null,
      productTerms: "strawberries organic"
    });
  });
});
