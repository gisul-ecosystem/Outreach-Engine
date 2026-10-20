type Level = "info" | "warn" | "error";

/** Tiny console logger with a timestamp and a scope, e.g. `2026-10-20T05:00:00.000Z [worker] started`. */
export function createLogger(scope: string) {
  const write = (level: Level, message: string, extra?: unknown) => {
    const line = `${new Date().toISOString()} [${scope}] ${message}`;
    const args = extra === undefined ? [line] : [line, extra];
    if (level === "error") console.error(...args);
    else if (level === "warn") console.warn(...args);
    else console.log(...args);
  };

  return {
    info: (message: string, extra?: unknown) => write("info", message, extra),
    warn: (message: string, extra?: unknown) => write("warn", message, extra),
    error: (message: string, extra?: unknown) => write("error", message, extra),
  };
}
