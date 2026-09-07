import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import { createLogger } from "@/logger";
import type { Project } from "@/types";

const log = createLogger("discord/authorization");

// The core check: does the acting Discord user match the task's owner?
export function isSameOwner(sourceUserId: string, targetOwnerId: string | null): boolean {
  return targetOwnerId !== null && sourceUserId === targetOwnerId;
}

// Authorization gate for /done, /free, /delete: only the task's owner or a
// server admin may act on a task that isn't theirs.
export function canManageTask(interaction: ChatInputCommandInteraction, taskOwnerId: string | null): boolean {
  const allowed =
    isSameOwner(interaction.user.id, taskOwnerId) ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false);
  log.debug(allowed ? "Task management authorized" : "Task management denied", {
    userId: interaction.user.id,
    taskOwnerId,
  });
  return allowed;
}

// Discord's default-permission system applies to a whole top-level command, not
// per-subcommand, so /project's mixed admin-only / team-lead-only subcommands are
// gated here in application code instead.
export function isServerAdmin(interaction: ChatInputCommandInteraction): boolean {
  const allowed = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  log.debug(allowed ? "Server admin check passed" : "Server admin check failed", { userId: interaction.user.id });
  return allowed;
}

// Authorization gate for /project configure|end|status: only the project's team
// lead (whoever ran /project start) may act — deliberately no admin override.
export function isTeamLead(interaction: ChatInputCommandInteraction, project: Project): boolean {
  const allowed = interaction.user.id === project.team_lead;
  log.debug(allowed ? "Team lead check passed" : "Team lead check failed", {
    userId: interaction.user.id,
    projectId: project.id,
  });
  return allowed;
}
