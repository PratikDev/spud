import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { deleteTask, findTaskByBranch } from "@/tasks";

export const deleteTaskCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete an unclaimed task from the board")
    .addStringOption((opt) =>
      opt
        .setName("branch")
        .setDescription("Branch of the unclaimed task to delete")
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

    if (!task || task.status !== "unclaimed") {
      await interaction.reply({
        content: `No unclaimed task found for branch \`${branchId}\`. Claimed or done tasks must be freed first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    deleteTask(task.id);
    await updateBoard(interaction.client, project);
    await interaction.reply(`Deleted task **${task.description}** (\`${task.branch_id}\`).`);
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "unclaimed");
  },
};
