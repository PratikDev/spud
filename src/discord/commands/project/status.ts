import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import { isTeamLead } from "@/discord/authorization";
import { NO_ACTIVE_PROJECT, NOT_TEAM_LEAD } from "@/discord/commands/constants";
import type { TaskStatus } from "@/types";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub
    .setName("status")
    .setDescription("Show the active project's title, repo, and task counts for this channel");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const project = await getActiveProject(interaction.channelId);

  if (!project) {
    await interaction.reply({
      content: NO_ACTIVE_PROJECT,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isTeamLead(interaction, project)) {
    await interaction.reply({ content: NOT_TEAM_LEAD, flags: MessageFlags.Ephemeral });
    return;
  }

  const countsRs = await db.execute({
    sql: "SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status",
    args: [project.id],
  });
  const counts = countsRs.rows as unknown as { status: TaskStatus; count: number }[];

  const countFor = (status: TaskStatus) => counts.find((row) => row.status === status)?.count ?? 0;

  const timeline =
    project.start_time && project.end_time
      ? `<t:${project.start_time}:F> → <t:${project.end_time}:F>`
      : "_not set — run `/project configure`_";
  const handbook = project.handbook_message_id
    ? `https://discord.com/channels/${interaction.guildId}/${project.channel_id}/${project.handbook_message_id}`
    : "_not uploaded_";

  await interaction.reply(
    [
      `**${project.title}** — \`${project.github_repo}\``,
      `Unclaimed: ${countFor("unclaimed")} · Claimed: ${countFor("claimed")} · Done: ${countFor("done")}`,
      `Team lead: <@${project.team_lead}>`,
      `Timeline: ${timeline}`,
      `Handbook: ${handbook}`,
    ].join("\n"),
  );
}
