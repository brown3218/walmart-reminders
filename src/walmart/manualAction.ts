export type WalmartAutomationArea = "catalog" | "orders" | "search" | "cart_add" | "cart_remove";

const manualActionPattern =
  /captcha|verify|verification code|sign in|log in|two[-\s]?step|security check|press and hold|not a robot|are you human|unusual activity/i;

export function detectWalmartManualAction(text: string): boolean {
  return manualActionPattern.test(text);
}

export function walmartManualActionMessage(area: WalmartAutomationArea): string {
  const labels: Record<WalmartAutomationArea, string> = {
    catalog: "catalog sync",
    orders: "order sync",
    search: "search",
    cart_add: "add to cart",
    cart_remove: "cart removal"
  };
  return `Walmart requires manual login or verification before ${labels[area]} can continue.`;
}
