import { describe, expect, test } from "bun:test";

import { slugify } from "@/utils/slugify";

describe("slugify", () => {
  test("lowercases and hyphenates a normal description", () => {
    expect(slugify("Add Login Page")).toBe("task/add-login-page");
  });

  test("strips punctuation and collapses separators", () => {
    expect(slugify("Fix bug: user's session (again)!!")).toBe("task/fix-bug-user-s-session-again");
  });

  test("trims leading/trailing hyphens produced by stripped punctuation", () => {
    expect(slugify("--wow--")).toBe("task/wow");
  });

  test("truncates very long descriptions", () => {
    const long = "a".repeat(100);
    const result = slugify(long);
    expect(result.startsWith("task/")).toBe(true);
    expect(result.length).toBeLessThanOrEqual("task/".length + 50);
  });

  test("falls back to a placeholder when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("task/untitled");
  });
});
