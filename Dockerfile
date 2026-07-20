FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN bun build ./index.ts --compile --outfile spud

# Runtime stage only needs the compiled binary — no bun, no node_modules, no
# source. The SQLite file lives in the container's own writable layer and is
# lost on restart/redeploy; that's fine for personal use, not worth paying
# for a volume to avoid.
FROM alpine:3.20

RUN apk add --no-cache libstdc++ libgcc
RUN adduser -D app
WORKDIR /app
COPY --from=build /app/spud ./spud
RUN chown -R app:app /app
USER app

EXPOSE 3000

ENTRYPOINT ["./spud"]
