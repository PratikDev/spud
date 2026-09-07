import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { canManageTask } from "@/discord/authorization";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT, NOT_TASK_OWNER } from "@/discord/commands/constants";
import { findTaskByBranch, freeTask } from "@/tasks";

export const free: Command = {
  data: new SlashCommandBuilder()
    .setName("free")
    .setDescription("Release a claimed task back to unclaimed")
    .addStringOption((opt) =>
      opt.setName("branch").setDescription("Branch of the task to free").setRequired(true).setAutocomplete(true),
    ),

  async execute(interaction) {
    const project = await getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    const branchId = interaction.options.getString("branch", true).trim();
    const task = await findTaskByBranch(project.id, branchId);

    if (task?.status !== "claimed") {
      await interaction.reply({
        content: `No claimed task found for branch \`${branchId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canManageTask(interaction, task.owner)) {
      await interaction.reply({ content: NOT_TASK_OWNER, flags: MessageFlags.Ephemeral });
      return;
    }

    await freeTask(task.id);
    await updateBoard(interaction.client, project);
    await interaction.reply(`Freed **${task.description}** (\`${task.branch_id}\`) back to unclaimed.`);
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "claimed");
  },
};
