export const REMINDERS_HELPER_TIMEOUT_MS = 90_000;

export function buildReadReminderArgs(scriptPath: string, listNames: string[]): string[] {
  return [scriptPath, ...listNames];
}
