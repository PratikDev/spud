import "./src/db";
import { startDiscordClient } from "./src/discord/client";
import { startWebhookServer } from "./src/github/webhook";
import { createLogger } from "./src/logger";

const log = createLogger("index");

startWebhookServer();
await startDiscordClient();
log.info("Spud is up");
