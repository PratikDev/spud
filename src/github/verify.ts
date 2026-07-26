import { createHmac, timingSafeEqual } from "node:crypto";

import { createLogger } from "@/logger";

const log = createLogger("github/verify");

// Recomputes GitHub's X-Hub-Signature-256 over the raw request body and
// compares it in constant time, so a wrong-length/guessed signature can't be
// distinguished by timing. Never logs the secret, the computed HMAC, or the
// incoming signature header itself — only whether verification passed.
export function verifySignature(rawBody: string, secret: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) {
    log.warn("Rejected webhook request with no signature header");
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) {
    log.warn("Rejected webhook request with malformed signature");
    return false;
  }

  const valid = timingSafeEqual(expectedBuffer, actualBuffer);
  if (valid) log.debug("Verified webhook signature");
  else log.warn("Rejected webhook request with invalid signature");
  return valid;
}
