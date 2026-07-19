import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import type { TaskStatus } from "@/types";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub.setName("status").setDescription("Show the active project's title, repo, and task counts for this channel");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const project = getActiveProject(interaction.channelId);

  if (!project) {
    await interaction.reply({
      content: "No active project in this channel. An admin needs to run `/project start` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const counts = db
    .query("SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status")
    .all(project.id) as { status: TaskStatus; count: number }[];

  const countFor = (status: TaskStatus) => counts.find((row) => row.status === status)?.count ?? 0;

  await interaction.reply(
    [
      `**${project.title}** — \`${project.github_repo}\``,
      `Unclaimed: ${countFor("unclaimed")} · Claimed: ${countFor("claimed")} · Done: ${countFor("done")}`,
    ].join("\n"),
  );
}
