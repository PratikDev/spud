import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub.setName("end").setDescription("End the active project in this channel (archives its data)");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const project = getActiveProject(interaction.channelId);

  if (!project) {
    await interaction.reply({
      content: NO_ACTIVE_PROJECT,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  db.query("UPDATE projects SET status = 'ended', ended_at = strftime('%s', 'now') WHERE id = ?").run(project.id);

  await interaction.reply(`Ended project **${project.title}**. Its board and task history are archived, not deleted.`);
}
