# Ziggy, served forever: `ziggy serve <slug…>` — feed → rendered reels → scheduled posts → reports.
# Keys reach it only as environment variables (POSTPROXY_API_KEY_<SLUG>); the state
# (fonts, renders, posts.jsonl, and — via symlinks — the campaigns the loop writes) lives
# in the /data volume. Campaigns are story content (gitignored): they must outlive the
# container, so each tenant's campaigns dir points into /data.
FROM node:22-bookworm-slim

# the shared libraries the HyperFrames renderer's headless Chromium needs, plus ffmpeg/ffprobe
# (the renderer shells out to them for the mp4) and unzip (what puppeteer extracts its browser
# zip with). Each missing one is a silent render failure, not a crash.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
      libcairo2 libx11-xcb1 libxcb1 libxrender1 libxext6 libxss1 libxtst6 libxi6 \
      fonts-liberation ca-certificates ffmpeg unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app

# The HyperFrames CLI, pinned and installed here: on demand (`npx --yes hyperframes@…`) every
# fresh container downloaded it on its first render, and parallel renders raced on the npx
# cache (ENOTEMPTY, "hyperframes: not found"). Keep the version in step with
# DEFAULT_HYPERFRAMES_VERSION in skill/scripts/video.mjs.
# No Claude Code here: a Claude session outside the container writes the summaries.
RUN npm install --global hyperframes@0.8.133 && npm cache clean --force
ENV ZIGGY_HYPERFRAMES_BIN=hyperframes

# The headless Chrome HyperFrames renders with, fetched here rather than on the first render:
# a container that starts with no browser would fail (or stall) on its very first story. The
# version tracks hyperframes 0.8.133 (DEFAULT_HYPERFRAMES_VERSION in skill/scripts/video.mjs) —
# bump both together. PUPPETEER_CACHE_DIR is puppeteer's own default, spelled out so a future
# base image that moves $HOME cannot silently lose the browser.
ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@152.0.7977.30 \
      --path "$PUPPETEER_CACHE_DIR" \
    && chown -R node:node /home/node/.cache

# tenants/<slug>/campaigns → /data/campaigns/<slug>: created fresh on a new volume, seeded on an
# existing one; the loop keeps working with a brand-new volume because a covered story is
# re-created from the feed, never lost
RUN for slug in ragusa alienwatch; do \
      mkdir -p "/data/campaigns/$slug" "/app/tenants/$slug"; \
      rm -rf "/app/tenants/$slug/campaigns"; \
      ln -s "/data/campaigns/$slug" "/app/tenants/$slug/campaigns"; \
    done && mkdir -p /data && chown -R node:node /data

ENV ZIGGY_REPO=/app \
    ZIGGY_HOME=/data
VOLUME ["/data"]
USER node
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://localhost:'+(process.env.ZIGGY_SERVE_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "skill/index.js"]
# see docker-compose.yml — or by hand:
# docker run -v ziggy-data:/data --env-file .env.docker ziggy serve ragusa alienwatch
