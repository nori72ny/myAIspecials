# Multi-stage production image for ACOS 2.0
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

WORKDIR /app
ARG ORIGIN_RELEASE_SHA

COPY package*.json ./
RUN npm ci

COPY . .
RUN node scripts/assert-origin-release-sha.mjs "$ORIGIN_RELEASE_SHA"
RUN printf '%s' "$ORIGIN_RELEASE_SHA" > /app/ORIGIN_RELEASE_SHA
RUN npm run build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

WORKDIR /app
ARG ORIGIN_RELEASE_SHA
ENV NODE_ENV=production
ENV FREE_ONLY=true
ENV ORIGIN_RELEASE_SHA=$ORIGIN_RELEASE_SHA
ENV ORIGIN_IMAGE_RELEASE_SHA_FILE=/app/ORIGIN_RELEASE_SHA
LABEL org.opencontainers.image.revision=$ORIGIN_RELEASE_SHA

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/ORIGIN_RELEASE_SHA ./ORIGIN_RELEASE_SHA
COPY --from=builder --chown=node:node /app/scripts/assert-origin-release-sha.mjs ./scripts/assert-origin-release-sha.mjs
COPY --from=builder --chown=node:node /app/scripts/assert-origin-production-env.mjs ./scripts/assert-origin-production-env.mjs
COPY --from=builder --chown=node:node /app/scripts/start-cloud-run.mjs ./scripts/start-cloud-run.mjs

USER node
EXPOSE 8080

CMD ["npm", "run", "start:cloud-run"]
