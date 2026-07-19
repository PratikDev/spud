import { Client, Events, GatewayIntentBits } from "discord.js";

import { env } from "@/env";
import { commands } from "./commands";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;

  const command = commands.find((c) => c.data.name === interaction.commandName);
  if (!command) return;

  if (interaction.isChatInputCommand()) {
    await command.execute(interaction);
  } else if (command.autocomplete) {
    await command.autocomplete(interaction);
  }
});

export function startDiscordClient() {
  return client.login(env.DISCORD_TOKEN);
}
