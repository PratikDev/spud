import { describe, expect, test } from "bun:test";

import { generateBranchName } from "@/utils/branch-name";
import { MAX_SLUG_LENGTH, MAX_SLUG_WORDS, TYPE_RULES } from "@/utils/branch-name-dictionary";

describe("generateBranchName", () => {
  const cases: Array<[string, string]> = [
    ["Fix the login bug on mobile", "fix/login-mobile"],
    ["Add dark mode toggle to settings page", "feature/dark-mode-toggle-settings-page"],
    ["Update README with setup instructions", "docs/setup-instructions"],
    ["Refactor auth middleware", "refactor/auth-middleware"],
    ["Update dependencies", "chore/update-dependencies"],
    ["Improve performance of search", "feature/improve-performance-search"],
    ["Login", "feature/login"],
    ["Add tests for login", "chore/login"],
  ];

  test.each(cases)("%s -> %s", (description, expected) => {
    expect(generateBranchName(description)).toBe(expected);
  });

  test("is deterministic", () => {
    const description = "Fix the login bug on mobile";
    expect(generateBranchName(description)).toBe(generateBranchName(description));
  });

  test("an earlier rule beats a later one (docs over fix)", () => {
    expect(generateBranchName("Fix README typo")).toBe("docs/fix-typo");
  });

  test("never repeats the matched type's own trigger words in the slug", () => {
    const slug = generateBranchName("Fix the login bug").split("/")[1] ?? "";
    expect(slug.split("-")).not.toContain("fix");
    expect(slug.split("-")).not.toContain("bug");
  });

  test("strips ticket references and bare numbers", () => {
    expect(generateBranchName("Add export button #123 for ABC-45 reports 2024")).toBe("feature/export-button-reports");
  });

  test("strips punctuation and accents", () => {
    expect(generateBranchName("Fix café menu: what's 'wrong'?!")).toBe("fix/cafe-menu-what-s-wrong");
  });

  test("collapses consecutive duplicate words", () => {
    expect(generateBranchName("login login login page")).toBe("feature/login-page");
  });

  test("caps the slug at the word limit", () => {
    const slug = generateBranchName("one two three four five six seven eight").split("/")[1] ?? "";
    expect(slug.split("-")).toHaveLength(MAX_SLUG_WORDS);
  });

  test("caps the slug at the length limit, cutting on a word boundary", () => {
    const slug = generateBranchName("internationalization infrastructure documentation").split("/")[1] ?? "";
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug).not.toMatch(/-$/);
  });

  test("truncates a single over-long word", () => {
    const slug = generateBranchName("a".repeat(100)).split("/")[1] ?? "";
    expect(slug).toHaveLength(MAX_SLUG_LENGTH);
  });

  test("falls back to a placeholder when nothing usable remains", () => {
    expect(generateBranchName("!!!")).toBe("feature/untitled");
    expect(generateBranchName("বাংলা")).toBe("feature/untitled");
  });

  test("produces only valid git-friendly characters", () => {
    for (const description of ["Fix: it's ~broken^ [now]?", "  spaces   everywhere  ", "UPPER CASE TASK"]) {
      expect(generateBranchName(description)).toMatch(/^[a-z]+\/[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("every type in the dictionary is reachable", () => {
    for (const rule of TYPE_RULES) {
      const trigger = rule.triggers[0] ?? "";
      expect(generateBranchName(`${trigger} something`).startsWith(`${rule.type}/`)).toBe(true);
    }
  });
});
