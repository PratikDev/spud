import winston from "winston";
import LokiTransport from "winston-loki";

type Level = "debug" | "info" | "warn" | "error";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const LOKI_HOST = process.env.LOKI_HOST;
const USER_ID = process.env.USER_ID;
const GRAFANA_CLOUD_TOKEN = process.env.GRAFANA_CLOUD_TOKEN;
const LOKI_ENABLED = Boolean(LOKI_HOST && USER_ID && GRAFANA_CLOUD_TOKEN);

const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp, scope, ...meta }) => {
    const metaSuffix = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${String(level).toUpperCase()}] [${scope}] ${message}${metaSuffix}`;
  }),
);

const transports: winston.transport[] = [new winston.transports.Console({ format: consoleFormat })];

if (LOKI_ENABLED) {
  transports.push(
    new LokiTransport({
      host: LOKI_HOST as string,
      basicAuth: `${USER_ID}:${GRAFANA_CLOUD_TOKEN}`,
      labels: { service_name: "spud" },
      json: true,
      format: winston.format.json(),
      replaceTimestamp: true,
      onConnectionError: (error) => console.error("[logger] Loki connection error:", error),
    }),
  );
}

const winstonLogger = winston.createLogger({ level: LOG_LEVEL, transports });

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const log = (level: Level, message: string, meta?: Record<string, unknown>) => {
    winstonLogger.log(level, message, { ...meta, scope });
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}
