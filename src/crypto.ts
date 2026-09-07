import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/env";
import { createLogger } from "@/logger";

const log = createLogger("crypto");

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
if (key.length !== 32) {
  throw new Error(`ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM, got ${key.length}`);
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

// Values written before this feature existed are still plain, unprefixed
// strings — pass those through unchanged instead of failing, so existing
// rows keep working until they're next rewritten (e.g. re-encrypted by a
// migration, or naturally overwritten).
export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) {
    log.warn("Reading an unencrypted legacy value");
    return value;
  }

  const [ivB64, authTagB64, ciphertextB64] = value.slice(PREFIX.length).split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted value");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
