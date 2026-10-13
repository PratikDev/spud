import { APICallError } from "ai";
import { MessageFlags, SlashCommandBuilder } from "discord.js";

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

// Maps a failed Gemini call to a user-facing note. Spud's own key is behind
// every call, so a bad key isn't something the team can fix — only the rate
// limit case is worth calling out separately (it clears on its own).
export function describeAiFailure(error: unknown): string {
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return "AI overlap detection failed — Gemini rate limit hit. Task created without it; it should work again shortly.";
  }
  return "AI overlap detection failed unexpectedly. Task created without it — try again in a bit if this keeps happening.";
}

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
    // Deferred immediately — a Gemini call below can comfortably outlast
    // Discord's 3s ack window, which otherwise shows the user a bare
    // "The application did not respond" with no indication anything happened.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const project = await getActiveProject(interaction.channelId);
    if (!project) {
      await interaction.editReply({ content: NO_ACTIVE_PROJECT });
      return;
    }

    const description = interaction.options.getString("description", true).trim();
    const existing = await findTaskByDescription(project.id, description, "unclaimed");

    let task: Task;
    let aiNote = "";

    if (existing) {
      await claimExistingTask(existing.id, interaction.user.id);
      task = existing;
    } else {
      let branchName: string;
      const allTasks = await getTasksForProject(project.id);

      try {
        const analysis = await analyzeClaim(
          description,
          allTasks.map((t) => t.description),
        );

        const overlapping = allTasks.find((t) => t.description === analysis.overlappingTask);
        if (overlapping) {
          const owner = overlapping.owner ? `<@${overlapping.owner}>'s` : "an existing";
          await interaction.editReply({
            content: [
              `This looks like a duplicate of ${owner} task **${overlapping.description}** (\`${overlapping.branch_id}\`) - *${overlapping.status}*.`,
              "If you think it isn't, please try again with a more detailed description.",
            ].join("\n"),
          });
          return;
        }

        branchName = analysis.branchName;
      } catch (error) {
        // Rate limit, bad key, network blip, or anything else Gemini can
        // throw — degrade to a plain slug rather than losing the claim
        // entirely. analyzeClaim already logged the underlying error.
        branchName = slugify(description);
        aiNote = `\n-# ${describeAiFailure(error)}`;
      }

      const branchId = await ensureUniqueBranchId(project.id, branchName);
      task = await createAndClaimTask(project.id, branchId, description, interaction.user.id);
    }

    await updateBoard(interaction.client, project);

    // The claim confirmation is intentionally public — the team should see
    // who's working on what without checking the board — but the deferral
    // above is ephemeral (needed for the error paths above), so swap the
    // placeholder out for a real, visible follow-up message.
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp(
      `Claimed **${task.description}** on \`${task.branch_id}\`.\n\`\`\`\ngit checkout -b ${task.branch_id}\n\`\`\`${aiNote}`,
    );
  },

  async autocomplete(interaction) {
    await respondWithTaskAutocomplete(interaction, "unclaimed", "description");
  },
};
