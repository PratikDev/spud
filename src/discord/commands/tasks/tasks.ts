import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { buildBoardEmbed } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { getTasksForProject } from "@/tasks";

export const tasks: Command = {
  data: new SlashCommandBuilder().setName("tasks").setDescription("Show the current task board for this channel"),

  async execute(interaction) {
    const project = await getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = buildBoardEmbed(project, await getTasksForProject(project.id));
    await interaction.reply({ embeds: [embed] });
  },
};
