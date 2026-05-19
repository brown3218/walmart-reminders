export function isWalmartProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return host === "walmart.com" && url.pathname.includes("/ip/");
  } catch {
    return false;
  }
}

export function extractWalmartProductId(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, "") !== "walmart.com") return null;
    return url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)/i)?.[1] ?? null;
  } catch {
    return value.match(/\/ip\/(?:[^/]+\/)?(\d+)/i)?.[1] ?? null;
  }
}
