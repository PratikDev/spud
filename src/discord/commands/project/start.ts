import { LibsqlError } from "@libsql/client";
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { z } from "zod";

import { db, getActiveProject, getActiveProjectByRepo } from "@/db";
import { updateBoard } from "@/discord/board";
import { APP_INSTALL_URL, getInstallationToken } from "@/github/app-auth";
import { getDefaultBranch } from "@/github/compare";

const inputSchema = z.object({
  title: z.string().trim().nonempty().max(200, "title must be 200 characters or fewer"),
  githubRepo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "must be in owner/repo format (e.g. octocat/hello-world)"),
});

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub
    .setName("start")
    .setDescription("Start a new active project in this channel")
    .addStringOption((opt) => opt.setName("title").setDescription("Project title").setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName("github-repo")
        .setDescription("GitHub repo as owner/repo (e.g. octocat/hello-world)")
        .setRequired(true),
    );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const parsed = inputSchema.safeParse({
    title: interaction.options.getString("title", true),
    githubRepo: interaction.options.getString("github-repo", true),
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    await interaction.reply({ content: `Invalid input: ${message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const { title, githubRepo } = parsed.data;

  if (await getActiveProject(interaction.channelId)) {
    await interaction.reply({
      content: "This channel already has an active project. Run `/project end` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (await getActiveProjectByRepo(githubRepo)) {
    await interaction.reply({
      content: `\`${githubRepo}\` is already linked to another active project in a different channel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Regex-validated as owner/repo above, so both parts are always present.
  const [repoOwner, repoName] = githubRepo.split("/") as [string, string];
  const installation = await getInstallationToken(repoOwner, repoName).catch(() => null);

  if (!installation) {
    await interaction.reply({
      content: `Spud needs the GitHub App installed on \`${githubRepo}\` first — install it, then try again: ${APP_INSTALL_URL}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let defaultBranch: string;
  try {
    // Fetched once here and cached on the project row, rather than re-fetched on
    // every push — also doubles as an early check that the repo actually exists.
    defaultBranch = await getDefaultBranch(githubRepo, installation.token);
  } catch {
    await interaction.reply({
      content: `Couldn't reach \`${githubRepo}\` on GitHub even with the GitHub App installed — check that the repo still exists.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await db.execute({
      sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, team_lead)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [interaction.channelId, interaction.guildId, title, githubRepo, defaultBranch, interaction.user.id],
    });
  } catch (error) {
    // The two partial unique indexes (one active project per channel, one per
    // repo) are the real guard — the checks above are just for a friendly
    // reply on the common path; this catches the rare race between them.
    if (error instanceof LibsqlError && error.extendedCode === "SQLITE_CONSTRAINT_UNIQUE") {
      await interaction.reply({
        content: "Couldn't start the project — this channel or repo just became linked to another active project.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }

  await interaction.reply(
    [
      `Started project **${title}**, linked to \`${githubRepo}\`. This channel's board is now active.`,
      "Push and pull-request events are wired up automatically through the installed GitHub App.",
    ].join("\n"),
  );

  const project = await getActiveProject(interaction.channelId);
  if (project) {
    await updateBoard(interaction.client, project);
  }
}
