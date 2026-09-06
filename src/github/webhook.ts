import { getProjectByPublicId } from "@/db";
import { updateBoard } from "@/discord/board";
import { client } from "@/discord/client";
import { env } from "@/env";
import { compareBranches } from "@/github/compare";
import { verifySignature } from "@/github/verify";
import { analyzeDrift } from "@/llm/drift";
import { createLogger } from "@/logger";
import { findTaskByBranch, markTaskDone } from "@/tasks";
import type { Project } from "@/types";

const log = createLogger("github/webhook");

// GitHub sends a "ping" event the moment a webhook is added — post the success
// confirmation in the project's channel so the whole team knows drift-checking
// is live, not just the admin who set it up (nothing sensitive in this message).
async function notifyWebhookConnected(project: Project) {
  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    log.warn("Could not post ping confirmation — channel not sendable", { projectId: project.id });
    return;
  }

  await channel.send(
    `✅ The GitHub webhook for **${project.title}** (\`${project.github_repo}\`) was connected successfully — pushes will now be checked for scope drift.`,
  );
  log.info("Confirmed webhook connection", { projectId: project.id });
}

async function processPushEvent(project: Project, request: Request, rawBody: string) {
  if (project.status !== "active") {
    log.debug("Ignoring push — project not active", { projectId: project.id });
    return;
  }

  const payload = JSON.parse(rawBody) as { ref?: string };
  if (!payload.ref?.startsWith("refs/heads/")) {
    log.debug("Ignoring push — ref is not a branch", { projectId: project.id, ref: payload.ref });
    return;
  }

  const branchId = payload.ref.slice("refs/heads/".length);
  if (branchId === project.default_branch) {
    log.debug("Ignoring push to default branch", { projectId: project.id, branchId });
    return;
  }

  const task = findTaskByBranch(project.id, branchId);
  if (!task || task.status !== "claimed") {
    log.debug("Ignoring push — no claimed task for branch", { projectId: project.id, branchId });
    return;
  }

  const [owner, repo] = project.github_repo.split("/");
  if (!owner || !repo) {
    log.error("Malformed github_repo on project", { projectId: project.id, githubRepo: project.github_repo });
    return;
  }

  const changedFiles = await compareBranches(owner, repo, project.default_branch, branchId);
  if (changedFiles.length === 0) {
    log.debug("No changed files vs default branch", { projectId: project.id, branchId });
    return;
  }

  const drift = await analyzeDrift(task.description, changedFiles);
  if (!drift.isDrifted) {
    log.info("Push analyzed, no drift detected", { projectId: project.id, branchId, taskId: task.id });
    return;
  }

  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    log.warn("Drift detected but channel not sendable", { projectId: project.id, taskId: task.id });
    return;
  }

  const fileList = changedFiles.map((file) => `\`${file.filename}\``).join(", ");
  const reasonSuffix = drift.reason ? ` (${drift.reason})` : "";
  await channel.send(
    `Hey <@${task.owner}> — your branch \`${branchId}\` also touches ${fileList}. Still just working on **${task.description}**?${reasonSuffix}`,
  );
  log.info("Posted drift nudge", { projectId: project.id, branchId, taskId: task.id, reason: drift.reason });
}

// GitHub's pull_request "closed" action fires both for merges and plain closes —
// only `merged: true` means the branch's work actually landed on the default branch.
async function processPullRequestEvent(project: Project, rawBody: string) {
  if (project.status !== "active") {
    log.debug("Ignoring pull_request event — project not active", { projectId: project.id });
    return;
  }

  const payload = JSON.parse(rawBody) as {
    action?: string;
    pull_request?: { number: number; merged: boolean; head: { ref: string } };
  };

  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    log.debug("Ignoring pull_request event — not a merge", { projectId: project.id, action: payload.action });
    return;
  }

  const branchId = payload.pull_request.head.ref;
  const task = findTaskByBranch(project.id, branchId);
  if (!task || task.status !== "claimed") {
    log.debug("Ignoring merge — no claimed task for branch", { projectId: project.id, branchId });
    return;
  }

  markTaskDone(task.id);
  await updateBoard(client, project);

  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    log.warn("Task closed on merge but channel not sendable", { projectId: project.id, taskId: task.id });
    return;
  }

  await channel.send(
    `✅ <@${task.owner}>'s task **${task.description}** was merged via \`${branchId}\` (PR #${payload.pull_request.number}) and marked done.`,
  );
  log.info("Closed task on merge", { projectId: project.id, taskId: task.id, branchId, pr: payload.pull_request.number });
}

export async function handleWebhookRequest(req: Bun.BunRequest<"/webhooks/github/:projectId">): Promise<Response> {
  const project = getProjectByPublicId(req.params.projectId);
  if (!project) {
    log.warn("Webhook request for unknown project", { publicId: req.params.projectId });
    return new Response("Not found", { status: 404 });
  }

  const rawBody = await req.text();
  if (!verifySignature(rawBody, project.webhook_secret, req.headers.get("x-hub-signature-256"))) {
    log.warn("Rejected webhook request with bad signature", { projectId: project.id });
    return new Response("Invalid signature", { status: 401 });
  }

  // Only reachable once signature verification passes, so from here on we always
  // return 200 — GitHub treats non-2xx as a delivery failure and retries/flags
  // the webhook as unhealthy, which we don't want for our own no-op cases.
  const startedAt = performance.now();
  const githubEvent = req.headers.get("x-github-event");

  try {
    log.debug("Handling webhook event", { projectId: project.id, githubEvent });

    if (githubEvent === "ping") {
      await notifyWebhookConnected(project);
    } else if (githubEvent === "push") {
      await processPushEvent(project, req, rawBody);
    } else if (githubEvent === "pull_request") {
      await processPullRequestEvent(project, rawBody);
    } else {
      log.debug("Ignoring unhandled webhook event", { projectId: project.id, githubEvent });
    }
  } catch (error) {
    log.error("Error processing webhook", {
      projectId: project.id,
      githubEvent,
      durationMs: Math.round(performance.now() - startedAt),
      error: String(error),
    });
    return new Response("OK", { status: 200 });
  }

  log.info("Webhook request handled", {
    projectId: project.id,
    githubEvent,
    durationMs: Math.round(performance.now() - startedAt),
  });
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
  log.info("Webhook server listening", { port: server.port });
  return server;
}
