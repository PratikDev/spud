FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

# Persist the SQLite file across restarts/redeploys by mounting a volume at /data.
ENV DATABASE_PATH=/data/spud.sqlite
RUN mkdir -p /data && chown bun:bun /data
VOLUME ["/data"]

USER bun

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
