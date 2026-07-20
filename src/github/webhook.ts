import { getProjectById } from "@/db";
import { client } from "@/discord/client";
import { env } from "@/env";
import { compareBranches, getDefaultBranch } from "@/github/compare";
import { verifySignature } from "@/github/verify";
import { analyzeDrift } from "@/llm/drift";
import { findTaskByBranch } from "@/tasks";
import type { Project } from "@/types";

const WEBHOOK_PATH_PATTERN = /^\/webhooks\/github\/(\d+)$/;

async function processPushEvent(project: Project, request: Request, rawBody: string) {
  if (project.status !== "active") return;
  if (request.headers.get("x-github-event") !== "push") return;

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

export async function handleWebhookRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return new Response("OK", { status: 200 });
  }

  if (request.method !== "POST") return new Response("Not found", { status: 404 });

  const match = url.pathname.match(WEBHOOK_PATH_PATTERN);
  if (!match?.[1]) return new Response("Not found", { status: 404 });

  const project = getProjectById(Number(match[1]));
  if (!project) return new Response("Not found", { status: 404 });

  const rawBody = await request.text();
  if (!verifySignature(rawBody, project.webhook_secret, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Only reachable once signature verification passes, so from here on we always
  // return 200 — GitHub treats non-2xx as a delivery failure and retries/flags
  // the webhook as unhealthy, which we don't want for our own no-op cases.
  try {
    await processPushEvent(project, request, rawBody);
  } catch (error) {
    console.error(`Error processing webhook for project ${project.id}:`, error);
  }

  return new Response("OK", { status: 200 });
}

export function startWebhookServer() {
  const server = Bun.serve({
    port: env.PORT,
    fetch: handleWebhookRequest,
  });
  console.log(`Webhook server listening on port ${server.port}`);
  return server;
}
