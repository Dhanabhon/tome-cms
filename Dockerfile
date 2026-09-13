FROM node:22-alpine AS builder
WORKDIR /app
ARG TOME_CMS_VERSION
ARG TOME_CMS_COMMIT_SHA
LABEL org.opencontainers.image.source="https://github.com/Dhanabhon/tome-cms" \
      org.opencontainers.image.version=$TOME_CMS_VERSION \
      org.opencontainers.image.revision=$TOME_CMS_COMMIT_SHA
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG TOME_CMS_VERSION
ARG TOME_CMS_COMMIT_SHA
LABEL org.opencontainers.image.source="https://github.com/Dhanabhon/tome-cms" \
      org.opencontainers.image.version=$TOME_CMS_VERSION \
      org.opencontainers.image.revision=$TOME_CMS_COMMIT_SHA
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 \
    TOME_CMS_VERSION=$TOME_CMS_VERSION \
    TOME_CMS_COMMIT_SHA=$TOME_CMS_COMMIT_SHA
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
RUN apk add --no-cache postgresql-client
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/scripts/db-migrate.ts ./scripts/db-migrate.ts
COPY --from=builder --chown=node:node /app/scripts/backup.ts ./scripts/backup.ts
COPY --from=builder --chown=node:node /app/src/server/db ./src/server/db
COPY --from=builder --chown=node:node /app/src/server/env.ts ./src/server/env.ts
COPY --from=builder --chown=node:node /app/src/server/media ./src/server/media
COPY --from=builder --chown=node:node /app/src/lib/media.ts ./src/lib/media.ts
RUN node --import tsx scripts/backup.ts --self-test
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
