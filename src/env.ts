import { createLogger } from "@/logger";

const log = createLogger("env");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log.error("Missing required env var", { name });
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  DISCORD_TOKEN: requireEnv("DISCORD_TOKEN"),
  DISCORD_CLIENT_ID: requireEnv("DISCORD_CLIENT_ID"),
  GOOGLE_GENERATIVE_AI_API_KEY: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
  GEMINI_MODEL_NAME: requireEnv("GEMINI_MODEL_NAME"),
  // Base64-encoded 32-byte key for AES-256-GCM, used to encrypt sensitive
  // columns (webhook_secret, and later a user-provided Gemini API key) at
  // rest — generate with `openssl rand -base64 32`.
  ENCRYPTION_KEY: requireEnv("ENCRYPTION_KEY"),
  // GitHub webhook (Feature 4) — all optional: PORT has a sane default,
  // and PUBLIC_BASE_URL is only used for display.
  PORT: Number(optionalEnv("PORT") ?? 3000),
  PUBLIC_BASE_URL: optionalEnv("PUBLIC_BASE_URL"),
  // Turso — optional: db.ts falls back to a local SQLite file (DATABASE_PATH,
  // itself defaulting to "spud.sqlite") when TURSO_DATABASE_URL is unset.
  TURSO_DATABASE_URL: optionalEnv("TURSO_DATABASE_URL"),
  TURSO_AUTH_TOKEN: optionalEnv("TURSO_AUTH_TOKEN"),
  DATABASE_PATH: optionalEnv("DATABASE_PATH") ?? "spud.sqlite",
};

log.info("Environment loaded", { port: env.PORT, publicBaseUrlSet: Boolean(env.PUBLIC_BASE_URL) });
