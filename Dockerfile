FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

# @libsql/client loads a platform-specific native binding (e.g.
# @libsql/linux-x64-musl) at runtime, resolved dynamically rather than via a
# static import — bun build --compile can't bundle that into a standalone
# binary, and a runtime stage with no node_modules has nowhere to find it.
# Running via `bun run` with real node_modules avoids that class of problem
# entirely, at the cost of a larger image than the compiled-binary approach.
#
# The SQLite file (local dev fallback only — set TURSO_DATABASE_URL in
# production) lives in the container's own writable layer and is lost on
# restart/redeploy; that's fine for personal use, not worth paying for a
# volume to avoid.
RUN adduser -D app && chown -R app:app /app
USER app

EXPOSE 3000

ENTRYPOINT ["bun", "run", "index.ts"]
