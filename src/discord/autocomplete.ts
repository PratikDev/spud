import type { AutocompleteInteraction } from "discord.js";

import { getActiveProject } from "@/db";
import { listTasksByStatus } from "@/tasks";
import type { TaskStatus } from "@/types";

// "description": suggest+match on the task description, name === value (used by /claim).
// "branch": suggest+match on the branch ID, showing the description alongside it
// (used by /done, /free, /delete-task, which all take a branch as input).
type MatchField = "description" | "branch";

export async function respondWithTaskAutocomplete(
  interaction: AutocompleteInteraction,
  status: TaskStatus,
  matchField: MatchField = "branch",
) {
  const project = getActiveProject(interaction.channelId);
  if (!project) {
    console.warn(`No active project found for channel ${interaction.channelId} during autocomplete.`);
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();

  const matches = listTasksByStatus(project.id, status)
    .filter((task) => (matchField === "description" ? task.description : task.branch_id).toLowerCase().includes(focused))
    .slice(0, 25)
    .map((task) =>
      matchField === "description"
        ? { name: task.description.slice(0, 100), value: task.description.slice(0, 100) }
        : { name: `${task.branch_id} - ${task.description}`.slice(0, 100), value: task.branch_id },
    );

  await interaction.respond(matches);
}
