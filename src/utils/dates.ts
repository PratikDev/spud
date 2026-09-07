import * as chrono from "chrono-node";

import { createLogger } from "@/logger";

const log = createLogger("dates");

// Bangladesh Standard Time, UTC+6 year-round (no DST). Hardcoded rather than reading
// the host's local timezone, so parsing is consistent no matter where this process runs.
const BD_UTC_OFFSET_MINUTES = 360;

// No multi-timezone support: every date is assumed to be BD time regardless of who's typing it.
export function parseWhen(text: string, now: Date): number | null {
  const parsed = chrono.parseDate(text, { instant: now, timezone: BD_UTC_OFFSET_MINUTES });
  if (!parsed) {
    log.warn("Failed to parse natural language date", { text });
    return null;
  }
  const epochSeconds = Math.floor(parsed.getTime() / 1000);
  log.info("Parsed natural language date", { text, epochSeconds });
  return epochSeconds;
}
