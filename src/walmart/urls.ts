export function isWalmartProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return host === "walmart.com" && url.pathname.includes("/ip/");
  } catch {
    return false;
  }
}
