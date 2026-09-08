import { describe, expect, test } from "bun:test";
import { createVerify } from "node:crypto";

import { env } from "@/env";
import { APP_INSTALL_URL, signAppJwt } from "@/github/app-auth";

function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("signAppJwt", () => {
  test("produces a well-formed three-part JWT", () => {
    const jwt = signAppJwt();
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  test("header declares RS256", () => {
    const [headerPart] = signAppJwt().split(".");
    expect(decodePart(headerPart as string)).toEqual({ alg: "RS256", typ: "JWT" });
  });

  test("payload has the app id as issuer and an expiry within GitHub's 10-minute cap", () => {
    const now = Math.floor(Date.now() / 1000);
    const [, payloadPart] = signAppJwt().split(".");
    const payload = decodePart(payloadPart as string) as { iss: string; iat: number; exp: number };

    expect(payload.iss).toBe(env.GITHUB_APP_ID);
    expect(payload.exp).toBeGreaterThan(payload.iat);
    // GitHub's 10-minute cap is on `exp` relative to *now* (when the token is
    // actually issued/validated) — `iat` is separately backdated for clock
    // drift, so `exp - iat` alone is expected to exceed 600s.
    expect(payload.exp - now).toBeLessThanOrEqual(600);
  });

  test("the signature actually verifies against the corresponding private key's public half", () => {
    const jwt = signAppJwt();
    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    const signingInput = `${headerPart}.${payloadPart}`;

    const publicKey = createVerify("RSA-SHA256").update(signingInput);
    // node:crypto can derive the public key check straight from the private key PEM.
    const isValid = publicKey.verify(env.GITHUB_APP_PRIVATE_KEY, Buffer.from(signaturePart as string, "base64url"));

    expect(isValid).toBe(true);
  });
});

describe("APP_INSTALL_URL", () => {
  test("points at the configured app's install page", () => {
    expect(APP_INSTALL_URL).toBe(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  });
});
