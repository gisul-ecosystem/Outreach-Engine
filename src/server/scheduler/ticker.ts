// A tiny repeating-task runner for the worker. Not a setInterval: the next run is scheduled with
// setTimeout, so a slow run can never pile up on itself, and `stop()` can wait for work in progress.

export type Ticker = {
  /** Stop scheduling new runs and wait for the runs in progress to finish. */
  stop: () => Promise<void>;
};

export function startTicker(options: {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
  onError: (name: string, err: unknown) => void;
  /** true: the next run starts on time even if the previous one is still running (used by the sender,
   *  so one slow send never delays other inboxes). false: wait for the previous run to finish. */
  allowOverlap?: boolean;
}): Ticker {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const running = new Set<Promise<void>>();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(fire, options.intervalMs);
  };

  const fire = () => {
    if (stopped) return;
    const promise: Promise<void> = options
      .run()
      .then(
        () => undefined,
        (err) => options.onError(options.name, err),
      )
      .finally(() => {
        running.delete(promise);
        if (!options.allowOverlap) schedule();
      });
    running.add(promise);
    if (options.allowOverlap) schedule();
  };

  fire(); // first run right away

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.all([...running]);
    },
  };
}
