// Word lists behind generateBranchName (branch-name.ts) — all the "decisions"
// live here so tuning naming is a data edit, not a logic change. Every entry
// must be lowercase and a single word (the description is tokenized on
// anything that isn't a-z / 0-9 before matching).

export type BranchType = "feature" | "fix" | "chore" | "docs" | "refactor";

// Used when no rule below matches.
export const DEFAULT_BRANCH_TYPE: BranchType = "feature";

// Checked top to bottom — the FIRST rule with any matching token wins, so
// order is the tie-break (e.g. "Fix README typo" is docs, not fix). A matched
// rule's own trigger words are also dropped from the slug so the type never
// repeats itself ("fix/login", not "fix/fix-login-bug").
export const TYPE_RULES: ReadonlyArray<{ type: Exclude<BranchType, "feature">; triggers: readonly string[] }> = [
  {
    type: "docs",
    triggers: ["doc", "docs", "documentation", "readme", "changelog", "comment", "comments", "guide", "tutorial"],
  },
  {
    type: "fix",
    triggers: [
      "fix",
      "fixes",
      "fixed",
      "bug",
      "bugs",
      "crash",
      "crashes",
      "error",
      "errors",
      "broken",
      "hotfix",
      "regression",
    ],
  },
  {
    type: "refactor",
    triggers: ["refactor", "refactoring", "cleanup", "restructure", "reorganize", "rename", "simplify", "dedupe"],
  },
  {
    type: "chore",
    triggers: [
      "chore",
      "config",
      "configuration",
      "dependency",
      "dependencies",
      "deps",
      "bump",
      "upgrade",
      "ci",
      "lint",
      "docker",
      "deploy",
      "tooling",
      "test",
      "tests",
    ],
  },
];

// Grammar words with no value in a branch name.
export const STOPWORDS: readonly string[] = [
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "with",
  "and",
  "or",
  "please",
  "can",
  "we",
  "i",
  "need",
  "want",
  "should",
  "make",
  "let",
];

// Task-phrasing verbs that say nothing about WHAT the task is ("add X",
// "implement X"). Dropped from the slug, but restored if it would otherwise
// end up empty (e.g. "Update dependencies" -> chore/update-dependencies).
export const FILLER_WORDS: readonly string[] = ["add", "implement", "create", "support", "update"];

export const MAX_SLUG_WORDS = 5;
export const MAX_SLUG_LENGTH = 50;

// Slug when nothing usable is left (e.g. a description with no a-z/0-9 at all).
export const EMPTY_SLUG = "untitled";
