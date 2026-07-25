import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import type { Project } from "@/types";

// The core check: does the acting Discord user match the task's owner?
export function isSameOwner(sourceUserId: string, targetOwnerId: string | null): boolean {
  return targetOwnerId !== null && sourceUserId === targetOwnerId;
}

// Authorization gate for /done, /free, /delete: only the task's owner or a
// server admin may act on a task that isn't theirs.
export function canManageTask(interaction: ChatInputCommandInteraction, taskOwnerId: string | null): boolean {
  if (isSameOwner(interaction.user.id, taskOwnerId)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

// Discord's default-permission system applies to a whole top-level command, not
// per-subcommand, so /project's mixed admin-only / team-lead-only subcommands are
// gated here in application code instead.
export function isServerAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

// Authorization gate for /project configure|end|status: only the project's team
// lead (whoever ran /project start) may act — deliberately no admin override.
export function isTeamLead(interaction: ChatInputCommandInteraction, project: Project): boolean {
  return interaction.user.id === project.team_lead;
}
