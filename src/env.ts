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
  // GitHub webhook (Feature 4) — all optional: PORT has a sane default,
  // and PUBLIC_BASE_URL is only used for display.
  PORT: Number(optionalEnv("PORT") ?? 3000),
  PUBLIC_BASE_URL: optionalEnv("PUBLIC_BASE_URL"),
};

log.info("Environment loaded", { port: env.PORT, publicBaseUrlSet: Boolean(env.PUBLIC_BASE_URL) });
