import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";

import { endActiveProjectsForGuild } from "@/db";
import { env } from "@/env";
import { createLogger } from "@/logger";
import { commands } from "./commands";
import { handleModalSubmit, MODAL_CUSTOM_ID_PREFIX } from "./commands/project/set-gemini-key";

const log = createLogger("discord/client");

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  log.info("Logged in", { tag: readyClient.user.tag });
});

// Only fires on an actual kick/leave/delete, not a server outage (discord.js
// emits guildUnavailable separately for that). The bot has already lost API
// access to the guild by this point, so this only updates the database —
// no attempt to unpin the board.
client.on(Events.GuildDelete, async (guild) => {
  const count = await endActiveProjectsForGuild(guild.id);
  if (count > 0) {
    log.info("Ended active projects after guild removal", { guildId: guild.id, count });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Only one modal exists right now, so this is a direct dispatch rather than a
  // general modal registry — worth generalizing if a second one shows up.
  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith(MODAL_CUSTOM_ID_PREFIX)) return;
    try {
      await handleModalSubmit(interaction);
    } catch (error) {
      log.error("Error handling modal submit", { customId: interaction.customId, error: String(error) });
      const reply = { content: "Something went wrong saving that.", flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
    return;
  }

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
      log.info("Executed command", {
        commandName: interaction.commandName,
        // Not every command has subcommands (e.g. /claim) — false means
        // "return null instead of throwing" rather than "required".
        subcommand: interaction.options.getSubcommand(false),
        userId: interaction.user.id,
        durationMs,
      });
    } else if (command.autocomplete) {
      await command.autocomplete(interaction);
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    log.error("Error handling command", {
      commandName: interaction.commandName,
      subcommand: interaction.isChatInputCommand() ? interaction.options.getSubcommand(false) : null,
      durationMs,
      error: String(error),
    });
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
  log.info("Logging in to Discord");
  return client.login(env.DISCORD_TOKEN);
}
