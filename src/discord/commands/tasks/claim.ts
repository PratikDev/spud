import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getActiveProject } from "@/db";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { analyzeClaim } from "@/llm/claim-analysis";
import { claimExistingTask, createAndClaimTask, ensureUniqueBranchId, findTaskByDescription, listTasksByStatus } from "@/tasks";
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
    let overlapWarning: string | null = null;

    if (existing) {
      claimExistingTask(existing.id, interaction.user.id);
      task = existing;
    } else {
      const claimedTasks = listTasksByStatus(project.id, "claimed");
      const analysis = await analyzeClaim(
        description,
        claimedTasks.map((t) => t.description),
      );

      const branchId = ensureUniqueBranchId(project.id, analysis.branchName);
      task = createAndClaimTask(project.id, branchId, description, interaction.user.id);

      const overlapping = claimedTasks.find((t) => t.description === analysis.overlappingTask);
      if (overlapping) {
        const owner = overlapping.owner ? `<@${overlapping.owner}>'s` : "an existing";
        overlapWarning = `⚠️ This might be the same as ${owner} task **${overlapping.description}** (\`${overlapping.branch_id}\`) — is this genuinely different?\n\n`;
      }
    }

    await updateBoard(interaction.client, project);
    const confirmation = `Claimed **${task.description}** on \`${task.branch_id}\`.\n\`\`\`\ngit checkout -b ${task.branch_id}\n\`\`\``;
    await interaction.reply(`${overlapWarning ?? ""}${confirmation}`);
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "unclaimed", "description");
  },
};
