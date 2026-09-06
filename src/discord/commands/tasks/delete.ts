import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { canManageTask } from "@/discord/authorization";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NOT_TASK_OWNER, NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { deleteTask, findTaskByBranch } from "@/tasks";

export const deleteTaskCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete a task from the board")
    .addStringOption((opt) =>
      opt.setName("branch").setDescription("Branch of the task to delete").setRequired(true).setAutocomplete(true),
    ),

  async execute(interaction) {
    const project = await getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    const branchId = interaction.options.getString("branch", true).trim();
    const task = await findTaskByBranch(project.id, branchId);

    if (!task) {
      await interaction.reply({
        content: `No task found for branch \`${branchId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canManageTask(interaction, task.owner)) {
      await interaction.reply({ content: NOT_TASK_OWNER, flags: MessageFlags.Ephemeral });
      return;
    }

    await deleteTask(task.id);
    await updateBoard(interaction.client, project);
    await interaction.reply(`Deleted task **${task.description}** (\`${task.branch_id}\`).`);
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, undefined);
  },
};
