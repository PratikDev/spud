import { describe, expect, test } from "bun:test";

import { decrypt, encrypt } from "@/crypto";

describe("encrypt/decrypt", () => {
  test("round-trips a plaintext value", () => {
    const plaintext = "a-very-secret-webhook-secret";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  test("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-input-every-time";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  test("passes through a legacy unencrypted value unchanged", () => {
    expect(decrypt("plain-legacy-secret")).toBe("plain-legacy-secret");
  });

  test("rejects a tampered ciphertext", () => {
    const ciphertext = encrypt("tamper-test");
    const tampered = `${ciphertext.slice(0, -4)}abcd`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
