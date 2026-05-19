export const REMINDERS_HELPER_TIMEOUT_MS = 45_000;

export function buildReminderHelperArgs(scriptPath: string, listNames: string[]): string[] {
  return [scriptPath, ...listNames];
}
