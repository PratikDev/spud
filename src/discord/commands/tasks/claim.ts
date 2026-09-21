import { APICallError } from "ai";
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

// Maps a failed Gemini call to something the team lead can actually act on —
// "it broke" isn't actionable, "your key looks revoked" is.
export function describeAiFailure(error: unknown): string {
  if (APICallError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
    return "AI overlap detection failed — the Gemini key looks invalid or revoked. Task created without it; check the key with `/project set-gemini-key`.";
  }
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

    if (!project.start_time || !project.end_time) {
      await interaction.editReply({
        content: "Set this project's start and end time first with `/project configure` before claiming tasks.",
      });
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

      if (project.gemini_api_key) {
        const allTasks = await getTasksForProject(project.id);

        try {
          const analysis = await analyzeClaim(
            decrypt(project.gemini_api_key),
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
          // Rate limit, bad/revoked key, network blip, or anything else Gemini
          // can throw — degrade to the same no-AI path rather than losing the
          // claim entirely. analyzeClaim already logged the underlying error.
          branchName = slugify(description);
          aiNote = `\n-# ${describeAiFailure(error)}`;
        }
      } else {
        // No Gemini key configured for this project — no overlap check, and a
        // plain slug instead of an AI-generated `<type>/<slug>` branch name.
        branchName = slugify(description);
        aiNote =
          "\n-# AI overlap detection is off for this project — add a Gemini key with `/project set-gemini-key` to enable it.";
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
