const MAX_SLUG_LENGTH = 50;

// Non-AI fallback branch name when AI is unavailable (no GEMINI_API_KEY, or the call failed) —
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
