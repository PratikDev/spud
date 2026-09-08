import { randomBytes } from "node:crypto";
import { LibsqlError } from "@libsql/client";
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { z } from "zod";

import { encrypt } from "@/crypto";
import { db, getActiveProject } from "@/db";
import { updateBoard } from "@/discord/board";
import { env } from "@/env";
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
  const webhookSecret = randomBytes(32).toString("hex");

  // Regex-validated as owner/repo above, so both parts are always present.
  const [repoOwner, repoName] = githubRepo.split("/") as [string, string];
  const installation = await getInstallationToken(repoOwner, repoName).catch(() => null);

  let defaultBranch: string;
  try {
    // Fetched once here and cached on the project row, rather than re-fetched on
    // every push — also doubles as an early check that the repo actually exists.
    // Uses the GitHub App's installation token when it's installed on this repo
    // (works for private repos too); falls back to an unauthenticated call
    // otherwise, which only works for public repos.
    defaultBranch = await getDefaultBranch(githubRepo, installation?.token);
  } catch {
    await interaction.reply({
      content: installation
        ? `Couldn't reach \`${githubRepo}\` on GitHub even with the GitHub App installed — check that the repo still exists.`
        : `Couldn't reach \`${githubRepo}\` on GitHub. If it's private, install the GitHub App first, then try again: ${APP_INSTALL_URL}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await db.execute({
      sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, webhook_secret, team_lead)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        interaction.channelId,
        interaction.guildId,
        title,
        githubRepo,
        defaultBranch,
        encrypt(webhookSecret),
        interaction.user.id,
      ],
    });
  } catch (error) {
    // The partial unique index on projects(channel_id) WHERE status = 'active' is the
    // real guard against a second active project in the same channel; this catch just
    // turns that DB-level rejection into a friendly reply instead of a raw 500.
    if (error instanceof LibsqlError && error.extendedCode === "SQLITE_CONSTRAINT_UNIQUE") {
      await interaction.reply({
        content: `This channel already has an active project. Run \`/project end\` first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }

  await interaction.reply(
    `Started project **${title}**, linked to \`${githubRepo}\`. This channel's board is now active.`,
  );

  const project = await getActiveProject(interaction.channelId);
  if (project) {
    await updateBoard(interaction.client, project);
  }

  const webhookPath = `/webhooks/github/${project?.public_id ?? "?"}`;
  const payloadUrl = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}${webhookPath}` : webhookPath;
  const payloadUrlNote = env.PUBLIC_BASE_URL ? "" : " (prepend your host — `PUBLIC_BASE_URL` isn't set)";

  // Ephemeral + separate from the announcement above: this secret lets anyone forge
  // webhook payloads if it leaks, so only the team lead who ran the command should see it.
  await interaction.followUp({
    content: [
      "**GitHub webhook setup** (only you can see this — save the secret now, it won't be shown again):",
      `- Payload URL: \`${payloadUrl}\`${payloadUrlNote}`,
      "- Content type: `application/json`",
      `- Secret: \`${webhookSecret}\``,
      '- Events: `push` and `pull_request` (select individual events, not "Send me everything")',
      "",
      "Add this under the repo's **Settings → Webhooks → Add webhook**.",
      "",
      installation
        ? "Drift checks are authenticated via the installed GitHub App, so private repos work too."
        : `Drift checks call the GitHub API unauthenticated, so \`${githubRepo}\` needs to stay a **public** repo — or install the GitHub App for private-repo support: ${APP_INSTALL_URL}`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
