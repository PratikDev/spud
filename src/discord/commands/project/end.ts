import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import { isTeamLead } from "@/discord/authorization";
import { unpinBoard } from "@/discord/board";
import { NO_ACTIVE_PROJECT, NOT_TEAM_LEAD } from "@/discord/commands/constants";

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

  if (!isTeamLead(interaction, project)) {
    await interaction.reply({ content: NOT_TEAM_LEAD, flags: MessageFlags.Ephemeral });
    return;
  }

  db.query("UPDATE projects SET status = 'ended', ended_at = strftime('%s', 'now') WHERE id = ?").run(project.id);
  await unpinBoard(interaction.client, project);

  await interaction.reply(`Ended project **${project.title}**. Its board and task history are archived, not deleted.`);
}
