import { normalizeText } from "../parser/groceryParser.js";

export type ReconcileItem = {
  itemId: number;
  status: string;
  productId?: string | null;
  productUrl: string | null;
  productTitle: string;
};

export type WalmartOrderSnapshot = {
  orderId: string;
  placedAt: string | null;
  items: Array<{
    title: string;
    url?: string | null;
    productId?: string | null;
  }>;
};

export type FulfilledMatch = {
  itemId: number;
  orderId: string;
  reason: "product_id" | "product_url" | "title_similarity";
};

export function findFulfilledItems(items: ReconcileItem[], orders: WalmartOrderSnapshot[]): FulfilledMatch[] {
  const matches: FulfilledMatch[] = [];
  for (const item of items) {
    if (!["approved", "adding", "added_to_cart", "manual_action", "ordered"].includes(item.status)) continue;
    for (const order of orders) {
      const reason = findOrderMatchReason(item, order);
      if (!reason) continue;
      matches.push({ itemId: item.itemId, orderId: order.orderId, reason });
      break;
    }
  }
  return matches;
}

function findOrderMatchReason(item: ReconcileItem, order: WalmartOrderSnapshot): FulfilledMatch["reason"] | null {
  const itemUrl = canonicalProductUrl(item.productUrl);
  for (const orderItem of order.items) {
    if (item.productId && orderItem.productId && item.productId === orderItem.productId) return "product_id";
    if (itemUrl && canonicalProductUrl(orderItem.url ?? null) === itemUrl) return "product_url";
    if (titleSimilarity(item.productTitle, orderItem.title) >= 0.72) return "title_similarity";
  }
  return null;
}

function canonicalProductUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/ip\/[^/?#]+(?:\/\d+)?/i);
  return match?.[0].toLowerCase() ?? url.split(/[?#]/)[0].toLowerCase();
}

function titleSimilarity(left: string, right: string): number {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}
