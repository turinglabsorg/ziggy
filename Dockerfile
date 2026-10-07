# Ziggy, served forever: `ziggy serve <slug…>` — feed → rendered reels → scheduled posts → reports.
# Keys reach it only as environment variables (POSTPROXY_API_KEY_<SLUG>); the state
# (fonts, renders, posts.jsonl, and — via symlinks — the campaigns the loop writes) lives
# in the /data volume. Campaigns are story content (gitignored): they must outlive the
# container, so each tenant's campaigns dir points into /data.
FROM node:20-bookworm-slim

# the shared libraries the HyperFrames renderer's headless Chromium needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
      libcairo2 fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node . .

# `claude -p` writes the reel summaries (tenant.json → feed.agent); needs ANTHROPIC_API_KEY,
# and a tenant with feed.agent: null never spawns it
RUN npm install --global @anthropic-ai/claude-code && npm cache clean --force

# tenents/campaigns → /data/campaigns/<slug>: created fresh on a new volume, seeded on an
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
