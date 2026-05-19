export type WalmartAutomationQueue = {
  enqueue<T>(job: () => Promise<T>): Promise<T>;
};

export function createSerialAutomationQueue(): WalmartAutomationQueue {
  let tail = Promise.resolve();

  return {
    enqueue(job) {
      const run = tail.catch(() => undefined).then(job);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}
