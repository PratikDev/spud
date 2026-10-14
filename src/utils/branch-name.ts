import {
  type BranchType,
  DEFAULT_BRANCH_TYPE,
  EMPTY_SLUG,
  FILLER_WORDS,
  MAX_SLUG_LENGTH,
  MAX_SLUG_WORDS,
  STOPWORDS,
  TYPE_RULES,
} from "@/utils/branch-name-dictionary";

const stopwords = new Set(STOPWORDS);
const fillerWords = new Set(FILLER_WORDS);

// "#123" and "ABC-45" style issue references. Matched on the original text
// (before lowercasing) so only an uppercase prefix counts as a ticket id.
const TICKET_REFERENCE = /#\d+|\b[A-Z]{2,}-\d+\b/g;

function tokenize(description: string): string[] {
  return description
    .replace(TICKET_REFERENCE, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function detectType(tokens: string[]): { type: BranchType; triggers: ReadonlySet<string> } {
  for (const rule of TYPE_RULES) {
    const triggers = new Set(rule.triggers);
    if (tokens.some((token) => triggers.has(token))) {
      return { type: rule.type, triggers };
    }
  }
  return { type: DEFAULT_BRANCH_TYPE, triggers: new Set() };
}

function isNumeric(token: string): boolean {
  return /^\d+$/.test(token);
}

function dropConsecutiveDuplicates(tokens: string[]): string[] {
  return tokens.filter((token, index) => token !== tokens[index - 1]);
}

function joinWithinLimit(tokens: string[]): string {
  let slug = "";
  for (const token of tokens.slice(0, MAX_SLUG_WORDS)) {
    const next = slug ? `${slug}-${token}` : token;
    if (next.length > MAX_SLUG_LENGTH) break;
    slug = next;
  }
  // A single token longer than the limit still needs to produce something.
  return slug || (tokens[0] ?? "").slice(0, MAX_SLUG_LENGTH);
}

// Deterministic `<type>/<slug>` branch name from a task description — no
// model call. All word lists live in branch-name-dictionary.ts.
export function generateBranchName(description: string): string {
  const tokens = tokenize(description);
  const { type, triggers } = detectType(tokens);

  let slugTokens = dropConsecutiveDuplicates(
    tokens.filter(
      (token) => !triggers.has(token) && !stopwords.has(token) && !fillerWords.has(token) && !isNumeric(token),
    ),
  );

  // Nothing descriptive left (e.g. "Update dependencies") — bring back the
  // trigger/filler words rather than ending up with a bare type.
  if (slugTokens.length === 0) {
    slugTokens = dropConsecutiveDuplicates(tokens.filter((token) => !stopwords.has(token) && !isNumeric(token)));
  }

  return `${type}/${joinWithinLimit(slugTokens) || EMPTY_SLUG}`;
}
