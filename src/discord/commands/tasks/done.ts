import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { findTaskByBranch, markTaskDone } from "@/tasks";

export const done: Command = {
  data: new SlashCommandBuilder()
    .setName("done")
    .setDescription("Mark a claimed task as done")
    .addStringOption((opt) =>
      opt
        .setName("branch")
        .setDescription("Branch of the task to mark done")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    const project = getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    const branchId = interaction.options.getString("branch", true).trim();
    const task = findTaskByBranch(project.id, branchId);

    if (!task || task.status !== "claimed") {
      await interaction.reply({
        content: `No claimed task found for branch \`${branchId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    markTaskDone(task.id);
    await updateBoard(interaction.client, project);
    await interaction.reply(`Marked **${task.description}** (\`${task.branch_id}\`) as done.`);
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "claimed");
  },
};
