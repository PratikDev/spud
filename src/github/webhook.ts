import { decrypt } from "@/crypto";
import { getActiveProjectByRepo } from "@/db";
import { updateBoard } from "@/discord/board";
import { client } from "@/discord/client";
import { env } from "@/env";
import { getInstallationToken } from "@/github/app-auth";
import { compareBranches } from "@/github/compare";
import { consumeToken } from "@/github/rate-limit";
import { verifySignature } from "@/github/verify";
import { analyzeDrift } from "@/llm/drift";
import { createLogger } from "@/logger";
import { findTaskByBranch, markTaskDone } from "@/tasks";
import type { Project } from "@/types";

const log = createLogger("github/webhook");

async function processPushEvent(project: Project, rawBody: string) {
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

  const task = await findTaskByBranch(project.id, branchId);
  if (task?.status !== "claimed") {
    log.debug("Ignoring push — no claimed task for branch", { projectId: project.id, branchId });
    return;
  }

  if (!project.gemini_api_key) {
    log.debug("Skipping drift check — no Gemini key configured", { projectId: project.id, branchId });
    return;
  }

  const [owner, repo] = project.github_repo.split("/");
  if (!owner || !repo) {
    log.error("Malformed github_repo on project", { projectId: project.id, githubRepo: project.github_repo });
    return;
  }

  // Fresh token each time rather than caching one — installation tokens expire
  // after an hour, and pushes can land long after any earlier token would have.
  const installation = await getInstallationToken(owner, repo);
  if (!installation) {
    // The App was required at /project start — this means it's since been
    // uninstalled. Never fall back to an unauthenticated call for it.
    log.warn("Skipping drift check — GitHub App no longer installed", { projectId: project.id, branchId });
    return;
  }

  const changedFiles = await compareBranches(owner, repo, project.default_branch, branchId, installation.token);
  if (changedFiles.length === 0) {
    log.debug("No changed files vs default branch", { projectId: project.id, branchId });
    return;
  }

  const drift = await analyzeDrift(decrypt(project.gemini_api_key), task.description, changedFiles);
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
  const task = await findTaskByBranch(project.id, branchId);
  if (task?.status !== "claimed") {
    log.debug("Ignoring merge — no claimed task for branch", { projectId: project.id, branchId });
    return;
  }

  await markTaskDone(task.id);
  await updateBoard(client, project);

  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    log.warn("Task closed on merge but channel not sendable", { projectId: project.id, taskId: task.id });
    return;
  }

  await channel.send(
    `✅ <@${task.owner}>'s task **${task.description}** was merged via \`${branchId}\` (PR #${payload.pull_request.number}) and marked done.`,
  );
  log.info("Closed task on merge", {
    projectId: project.id,
    taskId: task.id,
    branchId,
    pr: payload.pull_request.number,
  });
}

// A single App-level webhook (configured once, on the App's own settings page)
// delivers push/pull_request events for every repo the App is installed on,
// so the project is resolved from the payload's repository field.
export async function handleWebhookRequest(req: Bun.BunRequest<"/webhooks/github/app">): Promise<Response> {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, env.GITHUB_APP_WEBHOOK_SECRET, req.headers.get("x-hub-signature-256"))) {
    log.warn("Rejected webhook request with bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const githubEvent = req.headers.get("x-github-event");
  if (githubEvent === "ping") {
    // Sent once when the App's webhook URL is first configured — not scoped
    // to any particular repo/installation, so there's nothing to route it to.
    log.info("Received webhook ping");
    return new Response("OK", { status: 200 });
  }

  let repoFullName: string | undefined;
  try {
    repoFullName = (JSON.parse(rawBody) as { repository?: { full_name: string } }).repository?.full_name;
  } catch {
    log.warn("Failed to parse webhook payload as JSON", { githubEvent });
    return new Response("OK", { status: 200 });
  }

  if (!repoFullName) {
    log.debug("Webhook event has no repository context, ignoring", { githubEvent });
    return new Response("OK", { status: 200 });
  }

  const project = await getActiveProjectByRepo(repoFullName);
  if (!project) {
    log.debug("No active Spud project linked to this repo", { repoFullName, githubEvent });
    return new Response("OK", { status: 200 });
  }

  if (!consumeToken(project.id)) {
    return new Response("Too many requests", { status: 429 });
  }

  // Only reachable once signature verification passes, so from here on we always
  // return 200 — GitHub treats non-2xx as a delivery failure and retries/flags
  // the webhook as unhealthy, which we don't want for our own no-op cases.
  const startedAt = performance.now();

  try {
    log.debug("Handling webhook event", { projectId: project.id, githubEvent });

    if (githubEvent === "push") {
      await processPushEvent(project, rawBody);
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

const landingPageFile = Bun.file(new URL("../../public/index.html", import.meta.url));
const termsFile = Bun.file(new URL("../../legal/terms.html", import.meta.url));
const privacyFile = Bun.file(new URL("../../legal/privacy.html", import.meta.url));

export function startWebhookServer() {
  const server = Bun.serve({
    port: env.PORT,
    routes: {
      "/": new Response(landingPageFile),
      "/health": new Response("OK"),
      "/terms": new Response(termsFile),
      "/privacy": new Response(privacyFile),
      "/webhooks/github/app": {
        POST: handleWebhookRequest,
      },
    },
  });
  log.info("Webhook server listening", { port: server.port });
  return server;
}
