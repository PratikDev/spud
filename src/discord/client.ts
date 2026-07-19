import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";

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

  try {
    if (interaction.isChatInputCommand()) {
      await command.execute(interaction);
    } else if (command.autocomplete) {
      await command.autocomplete(interaction);
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);
    if (!interaction.isChatInputCommand()) return;

    const reply = { content: "Something went wrong running that command.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

export function startDiscordClient() {
  return client.login(env.DISCORD_TOKEN);
}
