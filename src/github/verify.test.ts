import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { verifySignature } from "@/github/verify";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ hello: "world" });

  test("accepts a correctly signed body", () => {
    expect(verifySignature(body, secret, sign(body, secret))).toBe(true);
  });

  test("rejects a missing signature header", () => {
    expect(verifySignature(body, secret, null)).toBe(false);
  });

  test("rejects a signature computed with the wrong secret", () => {
    expect(verifySignature(body, secret, sign(body, "wrong-secret"))).toBe(false);
  });

  test("rejects a signature for a different body", () => {
    expect(verifySignature(body, secret, sign("tampered", secret))).toBe(false);
  });

  test("rejects a malformed/wrong-length signature", () => {
    expect(verifySignature(body, secret, "sha256=deadbeef")).toBe(false);
  });
});
