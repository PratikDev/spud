type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Reads directly from process.env rather than @/env, since env.ts throws on missing
// required vars and this needs to be usable from anywhere, including before/without
// that validation running.
const threshold = LEVEL_WEIGHT[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVEL_WEIGHT.info;

const CONSOLE_FN: Record<Level, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function write(level: Level, scope: string, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < threshold) return;

  const timestamp = new Date().toISOString();
  const metaSuffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  CONSOLE_FN[level](`[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}${metaSuffix}`);
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// One scoped logger per module (e.g. `createLogger("tasks")`) so every line is
// traceable to its source without needing a class or DI setup.
export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => write("debug", scope, message, meta),
    info: (message, meta) => write("info", scope, message, meta),
    warn: (message, meta) => write("warn", scope, message, meta),
    error: (message, meta) => write("error", scope, message, meta),
  };
}
