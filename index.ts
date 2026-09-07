import "./src/db";
import { db } from "./src/db";
import { client, startDiscordClient } from "./src/discord/client";
import { startWebhookServer } from "./src/github/webhook";
import { createLogger } from "./src/logger";

const log = createLogger("index");

const server = startWebhookServer();

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info("Shutting down", { signal });
  try {
    await server.stop();
    db.close();
    await client.destroy();
    log.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    log.error("Error during shutdown", { error: String(error) });
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await startDiscordClient();
log.info("Spud is up");
