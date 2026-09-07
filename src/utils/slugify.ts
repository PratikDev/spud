const MAX_SLUG_LENGTH = 50;

// Non-AI fallback branch name when a project has no Gemini API key configured —
// no attempt at guessing a type prefix (feature/fix/chore/...) since that needs
// judgment; every branch just gets a flat "task/" prefix instead.
export function slugify(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return `task/${slug || "untitled"}`;
}
