import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { encrypt } from "@/crypto";
import { db } from "@/db";
import { handleWebhookRequest } from "@/github/webhook";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function makeRequest(
  projectId: string,
  body: string,
  signature: string,
  event = "ping",
): Bun.BunRequest<"/webhooks/github/:projectId"> {
  return {
    params: { projectId },
    headers: new Headers({ "x-hub-signature-256": signature, "x-github-event": event }),
    text: async () => body,
  } as unknown as Bun.BunRequest<"/webhooks/github/:projectId">;
}

async function insertProject(channelId: string, guildId: string, secret: string): Promise<string> {
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, webhook_secret, team_lead)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING public_id`,
    args: [channelId, guildId, "Webhook Test", "o/r", "main", secret, "tester"],
  });
  return (rs.rows[0] as unknown as { public_id: string }).public_id;
}

describe("handleWebhookRequest routing", () => {
  test("404s for an unknown project id", async () => {
    const res = await handleWebhookRequest(makeRequest("does-not-exist", "{}", "sha256=irrelevant"));
    expect(res.status).toBe(404);
  });

  test("401s for a bad signature", async () => {
    const secret = "webhook-test-secret-401";
    const publicId = await insertProject("chan-webhook-401", "guild-webhook-401", secret);
    const body = JSON.stringify({ zen: "test" });

    const res = await handleWebhookRequest(makeRequest(publicId, body, sign(body, "wrong-secret")));
    expect(res.status).toBe(401);
  });

  test("200s for a correctly signed ping event", async () => {
    const secret = "webhook-test-secret-200";
    const publicId = await insertProject("chan-webhook-200", "guild-webhook-200", secret);
    const body = JSON.stringify({ zen: "test" });

    const res = await handleWebhookRequest(makeRequest(publicId, body, sign(body, secret)));
    expect(res.status).toBe(200);
  });

  test("200s for a correctly signed ping event when the stored secret is encrypted", async () => {
    const secret = "webhook-test-secret-encrypted";
    const publicId = await insertProject("chan-webhook-encrypted", "guild-webhook-encrypted", encrypt(secret));
    const body = JSON.stringify({ zen: "test" });

    const res = await handleWebhookRequest(makeRequest(publicId, body, sign(body, secret)));
    expect(res.status).toBe(200);
  });

  test("429s once the per-project rate limit is exhausted", async () => {
    const secret = "webhook-test-secret-429";
    const publicId = await insertProject("chan-webhook-429", "guild-webhook-429", secret);
    const body = JSON.stringify({ zen: "test" });
    const signature = sign(body, secret);

    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await handleWebhookRequest(makeRequest(publicId, body, signature));
    }
    expect(last?.status).toBe(429);
  });
});
