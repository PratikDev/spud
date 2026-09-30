# Repository Guidelines

## Build, Test, and Development Commands

Use the package scripts in `package.json`:

- `bun install` installs dependencies from `bun.lock`.
- `bun run dev` starts the local dev server.
- `bun run test` runs the test suite.
- `bun run start` serves the production build after `build`.
- `bun run lint` runs Biome lint.
- `bun run register-commands` registers the discord commands.
- `bun run typecheck` runs the TypeScript compiler in type-checking mode.

## Coding Style & Naming Conventions

Write TypeScript and TSX with strict compiler settings. Use the `@/*` path alias for repo-root imports. Try to avoid `any` or `unknown` types as much as possible. Keep **EVERYTHING** type-safe. Utility modules use short lowercase names such as `lib.ts` or `math.ts`. Never make a single file too long. Do code splitting with easily manageable/understandable file structure. always follow DRY strategy for everything. Whether it's a type/interface declaration or even a simple utility function. Never write same logic in multiple places. and keep everything easily extensible.

## Testing Guidelines

No automated test framework is currently configured. For now, validate changes with `bun run lint`. When adding tests, colocate them near the code as `*.test.ts` or `*.test.tsx`, and add a matching `test` script to `package.json`.

## Commit & Pull Request Guidelines

Keep commits atomic:
- commit only the files you touched and list each path explicitly. For tracked files run `git commit -m "<scoped message>" -- path/to/file1 path/to/file2`. For brand-new files, use the one-liner `git restore --staged :/ && git add "path/to/file1" "path/to/file2" && git commit -m "<scoped message>" -- path/to/file1 path/to/file2`.
- Always check the changed files by `git status` before committing.
- Never commit files from the thread context. Never change any file content before committing.
- PRs should explain user-visible impact, list schema or config changes, and link related issues. Pull requests should include a short summary, validation steps, and linked issues when relevant. Note any schema, environment, or migration impact explicitly.
- Do not commit any changes unless you're asked to.
- Commit messages shouldn't be too long. It should be short and straight to the point. Use imperative mood and present tense. For example, "Add feature" instead of "Added feature" or "Adding feature". Avoid vague messages like "fix", "update", or "refactor". Instead, describe what was changed and why. For example, "Fix bug in user authentication" or "Refactor code for better readability".
- Pull request comments should always be in casual tone, never include unnecessary descriptions or details, and should be include proper file references.

## Security & Configuration Tips

- Do not commit secrets, local environment files and generated output such as `out/` and `build/`.
- Treat any mock data as development data unless a backend integration explicitly replaces it.
- Do not move from one phase/task to another unless asked.
- Never deploy using vercel CLI directly. Always deploy by pushing to Github. vercel CLI is only for local testing and debugging.