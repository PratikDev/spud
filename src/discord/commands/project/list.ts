import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db } from "@/db";
import { isServerAdmin } from "@/discord/authorization";
import { NOT_ADMIN } from "@/discord/commands/constants";
import type { Project } from "@/types";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub.setName("list").setDescription("List all active projects across the server");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isServerAdmin(interaction)) {
    await interaction.reply({ content: NOT_ADMIN, flags: MessageFlags.Ephemeral });
    return;
  }

  const rs = await db.execute({
    sql: "SELECT * FROM projects WHERE guild_id = ? AND status = 'active'",
    args: [interaction.guildId],
  });
  const projects = rs.rows as unknown as Project[];

  if (projects.length === 0) {
    await interaction.reply({ content: "No active projects in this server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = projects.map((project) => `<#${project.channel_id}> — **${project.title}** (\`${project.github_repo}\`)`);

  // Ephemeral: this is a cross-channel admin view, so it shouldn't broadcast other
  // teams' project names/repos into whichever channel it's run from.
  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}
