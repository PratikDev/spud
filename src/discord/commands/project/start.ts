import { SQLiteError } from "bun:sqlite";
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { db, getActiveProject } from "@/db";
import { updateBoard } from "@/discord/board";
import { env } from "@/env";

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

  try {
    db.query(
      `INSERT INTO projects (channel_id, guild_id, title, github_repo, webhook_secret)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(interaction.channelId, interaction.guildId, title, githubRepo, webhookSecret);
  } catch (error) {
    // The partial unique index on projects(channel_id) WHERE status = 'active' is the
    // real guard against a second active project in the same channel; this catch just
    // turns that DB-level rejection into a friendly reply instead of a raw 500.
    if (error instanceof SQLiteError && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      await interaction.reply({
        content: `This channel already has an active project. Run \`/project end\` first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }

  await interaction.reply(`Started project **${title}**, linked to \`${githubRepo}\`. This channel's board is now active.`);

  const project = getActiveProject(interaction.channelId);
  if (project) {
    await updateBoard(interaction.client, project);
  }

  const webhookPath = `/webhooks/github/${project?.public_id ?? "?"}`;
  const payloadUrl = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}${webhookPath}` : webhookPath;
  const payloadUrlNote = env.PUBLIC_BASE_URL ? "" : " (prepend your host — `PUBLIC_BASE_URL` isn't set)";

  // Ephemeral + separate from the announcement above: this secret lets anyone forge
  // webhook payloads if it leaks, so only the admin who ran the command should see it.
  await interaction.followUp({
    content: [
      "**GitHub webhook setup** (only you can see this — save the secret now, it won't be shown again):",
      `- Payload URL: \`${payloadUrl}\`${payloadUrlNote}`,
      "- Content type: `application/json`",
      `- Secret: \`${webhookSecret}\``,
      "- Events: just the `push` event",
      "",
      "Add this under the repo's **Settings → Webhooks → Add webhook**.",
      "",
      `Note: drift checks call the GitHub API unauthenticated, so \`${githubRepo}\` needs to be a **public** repo.`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
