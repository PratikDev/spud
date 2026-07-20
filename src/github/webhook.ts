import { getProjectById } from "@/db";
import { client } from "@/discord/client";
import { env } from "@/env";
import { compareBranches, getDefaultBranch } from "@/github/compare";
import { verifySignature } from "@/github/verify";
import { analyzeDrift } from "@/llm/drift";
import { findTaskByBranch } from "@/tasks";
import type { Project } from "@/types";

// GitHub sends a "ping" event the moment a webhook is added — post the success
// confirmation in the project's channel so the whole team knows drift-checking
// is live, not just the admin who set it up (nothing sensitive in this message).
async function notifyWebhookConnected(project: Project) {
  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  await channel.send(
    `✅ The GitHub webhook for **${project.title}** (\`${project.github_repo}\`) was connected successfully — pushes will now be checked for scope drift.`,
  );
}

async function processPushEvent(project: Project, request: Request, rawBody: string) {
  if (project.status !== "active") return;

  const payload = JSON.parse(rawBody) as { ref?: string };
  if (!payload.ref?.startsWith("refs/heads/")) return;

  const branchId = payload.ref.slice("refs/heads/".length);
  const task = findTaskByBranch(project.id, branchId);
  if (!task || task.status !== "claimed") return;

  const [owner, repo] = project.github_repo.split("/");
  if (!owner || !repo) return;

  const defaultBranch = await getDefaultBranch(owner, repo);
  const changedFiles = await compareBranches(owner, repo, defaultBranch, branchId);
  if (changedFiles.length === 0) return;

  const drift = await analyzeDrift(task.description, changedFiles);
  if (!drift.isDrifted) return;

  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  const fileList = changedFiles.map((file) => `\`${file.filename}\``).join(", ");
  const reasonSuffix = drift.reason ? ` (${drift.reason})` : "";
  await channel.send(
    `Hey <@${task.owner}> — your branch \`${branchId}\` also touches ${fileList}. Still just working on **${task.description}**?${reasonSuffix}`,
  );
}

export async function handleWebhookRequest(req: Bun.BunRequest<"/webhooks/github/:projectId">): Promise<Response> {
  const projectId = Number(req.params.projectId);

  const project = getProjectById(projectId);
  if (!project) return new Response("Not found", { status: 404 });

  const rawBody = await req.text();
  if (!verifySignature(rawBody, project.webhook_secret, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Only reachable once signature verification passes, so from here on we always
  // return 200 — GitHub treats non-2xx as a delivery failure and retries/flags
  // the webhook as unhealthy, which we don't want for our own no-op cases.
  try {
    const githubEvent = req.headers.get("x-github-event");

    if (githubEvent === "ping") {
      await notifyWebhookConnected(project);
    } else if (githubEvent === "push") {
      await processPushEvent(project, req, rawBody);
    }
  } catch (error) {
    console.error(`Error processing webhook for project ${project.id}:`, error);
  }

  return new Response("OK", { status: 200 });
}

export function startWebhookServer() {
  const server = Bun.serve({
    port: env.PORT,
    routes: {
      "/health": new Response("OK"),
      "/webhooks/github/:projectId": {
        POST: handleWebhookRequest
      },
    },
  });
  console.log(`Webhook server listening on port ${server.port}`);
  return server;
}
