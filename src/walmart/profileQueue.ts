let queue = Promise.resolve();

export function runExclusiveWalmartProfileTask<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => undefined).then(task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
