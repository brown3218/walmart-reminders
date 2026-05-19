export type ParsedGroceryText = {
  rawText: string;
  normalizedText: string;
  quantityValue: number | null;
  quantityUnit: string | null;
  brandHint: string | null;
  productTerms: string;
};

const knownBrands = ["Great Value", "Diet Coke"];

export function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseGroceryText(rawText: string): ParsedGroceryText {
  let remaining = rawText.trim();
  let quantityValue: number | null = null;
  let quantityUnit: string | null = null;

  const multiplier = remaining.match(/^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i);
  if (multiplier) {
    quantityValue = Number(multiplier[1]);
    quantityUnit = "each";
    remaining = multiplier[2].trim();
  }

  const normalizedText = normalizeText(remaining);
  const brandHint = knownBrands.find((brand) => normalizedText.startsWith(normalizeText(brand))) ?? null;
  const productTerms = brandHint
    ? normalizedText.slice(normalizeText(brandHint).length).trim()
    : normalizedText;

  return {
    rawText,
    normalizedText,
    quantityValue,
    quantityUnit,
    brandHint,
    productTerms
  };
}
