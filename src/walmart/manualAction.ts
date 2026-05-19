export type WalmartAutomationArea = "catalog" | "orders" | "search" | "cart_add" | "cart_remove";
export type WalmartSessionDoctorRow = {
  status?: string | null;
  error_message?: string | null;
  needs_manual_action?: number | boolean | null;
};

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

export function formatWalmartSessionDoctorCheck(session: WalmartSessionDoctorRow | undefined): { ok: boolean; detail: string } {
  if (!session) return { ok: false, detail: "session row missing from SQLite database" };
  const status = session.status || "unknown";
  const message = session.error_message ? ` - ${session.error_message}` : "";
  if (Boolean(session.needs_manual_action)) {
    return { ok: false, detail: `needs manual action${message}` };
  }
  return { ok: true, detail: `${status}${message}` };
}
