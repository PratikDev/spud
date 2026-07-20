import { createHmac, timingSafeEqual } from "node:crypto";

// Recomputes GitHub's X-Hub-Signature-256 over the raw request body and
// compares it in constant time, so a wrong-length/guessed signature can't be
// distinguished by timing.
export function verifySignature(rawBody: string, secret: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
