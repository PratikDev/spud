import { createLogger } from "@/logger";

const log = createLogger("github/rate-limit");

const BUCKET_CAPACITY = 20;
const REFILL_INTERVAL_MS = 3_000;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<number, Bucket>();

export function consumeToken(projectId: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(projectId);

  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(projectId, bucket);
  }

  const refilled = Math.floor((now - bucket.lastRefill) / REFILL_INTERVAL_MS);
  if (refilled > 0) {
    bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + refilled);
    bucket.lastRefill += refilled * REFILL_INTERVAL_MS;
  }

  if (bucket.tokens <= 0) {
    log.warn("Rate limit exceeded for project", { projectId });
    return false;
  }

  bucket.tokens--;
  return true;
}
