import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { analyzeClaim } from "@/llm/claim-analysis";
import { claimExistingTask, createAndClaimTask, ensureUniqueBranchId, findTaskByDescription, getTasksForProject } from "@/tasks";
import type { Task } from "@/types";

export const claim: Command = {
  data: new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim a task, creating it first if it doesn't already exist")
    .addStringOption((opt) =>
      opt
        .setName("description")
        .setDescription("Pick a suggested task to claim it, or type new text to create one")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    const project = getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    const description = interaction.options.getString("description", true).trim();
    const existing = findTaskByDescription(project.id, description, "unclaimed");

    let task: Task;

    if (existing) {
      claimExistingTask(existing.id, interaction.user.id);
      task = existing;
    } else {
      const allTasks = getTasksForProject(project.id);
      const analysis = await analyzeClaim(
        description,
        allTasks.map((t) => t.description),
      );

      const overlapping = allTasks.find((t) => t.description === analysis.overlappingTask);
      if (overlapping) {
        const owner = overlapping.owner ? `<@${overlapping.owner}>'s` : "an existing";
        await interaction.reply({
          content: [
            `This looks like a duplicate of ${owner} task **${overlapping.description}** (\`${overlapping.branch_id}\`) - *${overlapping.status}*.`,
            "If you think it isn't, please try again with a more detailed description.",
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const branchId = ensureUniqueBranchId(project.id, analysis.branchName);
      task = createAndClaimTask(project.id, branchId, description, interaction.user.id);
    }

    await updateBoard(interaction.client, project);
    await interaction.reply(
      `Claimed **${task.description}** on \`${task.branch_id}\`.\n\`\`\`\ngit checkout -b ${task.branch_id}\n\`\`\``,
    );
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "unclaimed", "description");
  },
};
