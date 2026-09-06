import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";

import { env } from "@/env";
import { createLogger } from "@/logger";
import { commands } from "./commands";

const log = createLogger("discord/client");

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  log.info("Logged in", { tag: readyClient.user.tag });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;

  const command = commands.find((c) => c.data.name === interaction.commandName);
  if (!command) {
    log.warn("No handler registered for command", { commandName: interaction.commandName });
    return;
  }

  const startedAt = performance.now();

  try {
    if (interaction.isChatInputCommand()) {
      await command.execute(interaction);
      const durationMs = Math.round(performance.now() - startedAt);
      log.info("Executed command",
        {
          commandName: interaction.commandName,
          userId: interaction.user.id,
          durationMs
        }
      );
    } else if (command.autocomplete) {
      await command.autocomplete(interaction);
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    log.error("Error handling command",
      {
        commandName: interaction.commandName,
        durationMs,
        error: String(error)
      });
    if (!interaction.isChatInputCommand()) return;

    const reply = { content: "Something went wrong running that command.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => { });
    } else {
      await interaction.reply(reply).catch(() => { });
    }
  }
});

export function startDiscordClient() {
  log.info("Logging in to Discord");
  return client.login(env.DISCORD_TOKEN);
}
