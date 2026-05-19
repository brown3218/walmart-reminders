import type pino from "pino";
import type { AppConfig } from "../config/config.js";

type SyncJob = () => Promise<void>;

export function startWalmartSyncJobs(input: {
  config: AppConfig;
  logger: pino.Logger;
  runCatalog: SyncJob;
  runOrders: SyncJob;
}): NodeJS.Timeout[] {
  const handles: NodeJS.Timeout[] = [];
  let queue = Promise.resolve();
  const enqueue = (name: string, run: SyncJob) => {
    queue = queue
      .catch(() => undefined)
      .then(run)
      .catch((error) => {
        input.logger.warn({ error: error instanceof Error ? error.message : String(error) }, `${name} failed`);
      });
  };

  startJob({
    name: "walmart catalog sync",
    intervalMs: input.config.walmart.catalogSyncMinutes * 60 * 1000,
    run: input.runCatalog,
    handles,
    enqueue
  });
  startJob({
    name: "walmart order sync",
    intervalMs: input.config.walmart.orderSyncMinutes * 60 * 1000,
    run: input.runOrders,
    handles,
    enqueue
  });

  return handles;
}

function startJob(input: {
  name: string;
  intervalMs: number;
  run: SyncJob;
  handles: NodeJS.Timeout[];
  enqueue: (name: string, run: SyncJob) => void;
}): void {
  const execute = () => {
    input.enqueue(input.name, input.run);
  };
  setTimeout(execute, 0);
  input.handles.push(setInterval(execute, input.intervalMs));
}
