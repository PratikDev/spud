import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { decrypt } from "@/crypto";
import { getActiveProject } from "@/db";
import { respondWithTaskAutocomplete } from "@/discord/autocomplete";
import { updateBoard } from "@/discord/board";
import type { Command } from "@/discord/commands";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";
import { analyzeClaim } from "@/llm/claim-analysis";
import {
  claimExistingTask,
  createAndClaimTask,
  ensureUniqueBranchId,
  findTaskByDescription,
  getTasksForProject,
} from "@/tasks";
import type { Task } from "@/types";
import { slugify } from "@/utils/slugify";

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
    const project = await getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!project.start_time || !project.end_time) {
      await interaction.reply({
        content: "Set this project's start and end time first with `/project configure` before claiming tasks.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const description = interaction.options.getString("description", true).trim();
    const existing = await findTaskByDescription(project.id, description, "unclaimed");

    let task: Task;
    let aiUnavailable = false;

    if (existing) {
      await claimExistingTask(existing.id, interaction.user.id);
      task = existing;
    } else {
      let branchName: string;

      if (project.gemini_api_key) {
        const allTasks = await getTasksForProject(project.id);
        const analysis = await analyzeClaim(
          decrypt(project.gemini_api_key),
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

        branchName = analysis.branchName;
      } else {
        // No Gemini key configured for this project — no overlap check, and a
        // plain slug instead of an AI-generated `<type>/<slug>` branch name.
        aiUnavailable = true;
        branchName = slugify(description);
      }

      const branchId = await ensureUniqueBranchId(project.id, branchName);
      task = await createAndClaimTask(project.id, branchId, description, interaction.user.id);
    }

    await updateBoard(interaction.client, project);
    const aiNote = aiUnavailable
      ? "\n-# AI overlap detection is off for this project — add a Gemini key with `/project set-gemini-key` to enable it."
      : "";
    await interaction.reply(
      `Claimed **${task.description}** on \`${task.branch_id}\`.\n\`\`\`\ngit checkout -b ${task.branch_id}\n\`\`\`${aiNote}`,
    );
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "unclaimed", "description");
  },
};
