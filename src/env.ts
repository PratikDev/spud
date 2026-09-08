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
  // Not Spud's own key — each project supplies its own via /project
  // set-gemini-key, so only the model choice is global.
  GEMINI_MODEL_NAME: requireEnv("GEMINI_MODEL_NAME"),
  // Base64-encoded 32-byte key for AES-256-GCM, used to encrypt sensitive
  // columns (gemini_api_key) at rest — generate with `openssl rand -base64 32`.
  ENCRYPTION_KEY: requireEnv("ENCRYPTION_KEY"),
  // GitHub App — used to mint short-lived installation tokens so Spud can read
  // private repos the App is installed on (see github/app-auth.ts).
  GITHUB_APP_ID: requireEnv("GITHUB_APP_ID"),
  // The App's private key .pem, quoted as-is in .env (Bun's env loader keeps
  // embedded newlines inside a quoted value) — no encoding needed.
  GITHUB_APP_PRIVATE_KEY: requireEnv("GITHUB_APP_PRIVATE_KEY"),
  // The App's slug from its public page URL (github.com/apps/<slug>) — used
  // to build its install link.
  GITHUB_APP_SLUG: requireEnv("GITHUB_APP_SLUG"),
  // Secret configured on the App's own Webhook settings page — a single App-level
  // webhook delivers push/pull_request events for every repo it's installed on,
  // instead of each project needing its own manually-added webhook.
  GITHUB_APP_WEBHOOK_SECRET: requireEnv("GITHUB_APP_WEBHOOK_SECRET"),
  // PORT has a sane default; PUBLIC_BASE_URL is only used for display (the
  // landing-page link in /help).
  PORT: Number(optionalEnv("PORT") ?? 3000),
  PUBLIC_BASE_URL: optionalEnv("PUBLIC_BASE_URL"),
  // Turso — optional: db.ts falls back to a local SQLite file (DATABASE_PATH,
  // itself defaulting to "spud.sqlite") when TURSO_DATABASE_URL is unset.
  TURSO_DATABASE_URL: optionalEnv("TURSO_DATABASE_URL"),
  TURSO_AUTH_TOKEN: optionalEnv("TURSO_AUTH_TOKEN"),
  DATABASE_PATH: optionalEnv("DATABASE_PATH") ?? "spud.sqlite",
};

log.info("Environment loaded", { port: env.PORT, publicBaseUrlSet: Boolean(env.PUBLIC_BASE_URL) });
