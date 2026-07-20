import "./src/db";
import { startDiscordClient } from "./src/discord/client";
import { startWebhookServer } from "./src/github/webhook";

startWebhookServer();
await startDiscordClient();
