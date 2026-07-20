import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

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
