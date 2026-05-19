import { normalizeText, type ParsedGroceryText } from "../parser/groceryParser.js";

export type ReorderCatalogItem = {
  id: number;
  title: string;
  normalizedTitle: string;
  url: string;
  brand?: string | null;
  sizeText?: string | null;
};

export type MatchDecision = {
  decision: "auto_add" | "needs_review";
  confidence: number;
  reason: string;
  bestMatch: ReorderCatalogItem | null;
};

export function matchAgainstReorderCatalog(
  parsed: ParsedGroceryText,
  catalog: ReorderCatalogItem[]
): MatchDecision {
  let best: { item: ReorderCatalogItem; score: number } | null = null;

  for (const item of catalog) {
    const score = scoreReorderItem(parsed, item);
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 0.3) {
    return {
      decision: "needs_review",
      confidence: 0,
      reason: "Item was not previously ordered in the cached Walmart reorder catalog.",
      bestMatch: null
    };
  }

  const confidence = Math.min(1, Number(best.score.toFixed(2)));
  return {
    decision: confidence >= 0.9 ? "auto_add" : "needs_review",
    confidence,
    reason:
      confidence >= 0.9
        ? "Strong match to a previously ordered Walmart item."
        : "Possible prior-purchase match needs confirmation.",
    bestMatch: best.item
  };
}

function scoreReorderItem(parsed: ParsedGroceryText, item: ReorderCatalogItem): number {
  const title = item.normalizedTitle || normalizeText(item.title);
  const terms = tokenSet(parsed.productTerms);
  const titleTokens = tokenSet(title);
  const overlap = [...terms].filter((term) => titleTokens.has(term)).length;
  const overlapScore = terms.size === 0 ? 0 : overlap / terms.size;
  const brandScore =
    parsed.brandHint && item.brand && normalizeText(parsed.brandHint) === normalizeText(item.brand) ? 0.25 : 0;
  const phraseScore = title.includes(parsed.normalizedText) ? 0.25 : 0;
  return overlapScore * 0.7 + brandScore + phraseScore;
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}
