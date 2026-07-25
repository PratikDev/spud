import * as chrono from "chrono-node";

// No multi-timezone support: natural-language dates are parsed relative to whatever
// timezone this process runs in. Fine for a single team, not for distributed ones.
export function parseWhen(text: string, now: Date): number | null {
  const parsed = chrono.parseDate(text, now);
  return parsed ? Math.floor(parsed.getTime() / 1000) : null;
}