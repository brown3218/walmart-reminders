import type pino from "pino";
import type { AppConfig } from "../config/config.js";
import type { ReconciledFulfillment } from "../db/database.js";
import { applyReminderDisposition } from "../reminders/actions.js";

type ApplyReminderDisposition = typeof applyReminderDisposition;

export async function applyFulfilledReminderDispositions(input: {
  fulfilled: ReconciledFulfillment[];
  config: AppConfig;
  logger: pino.Logger;
  apply?: ApplyReminderDisposition;
}): Promise<void> {
  const apply = input.apply ?? applyReminderDisposition;
  await Promise.all(
    input.fulfilled
      .filter((match) => match.reminder)
      .map((match) =>
        apply(input.config, input.logger, {
          externalId: match.reminder!.externalId,
          reason: "fulfill"
        })
      )
  );
}
