# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:20-slim AS base

ARG TARGETARCH

ENV PNPM_HOME=/pnpm \
    PNPM_STORE_PATH=/pnpm-store \
    PATH=/pnpm:$PATH

RUN corepack enable \
 && corepack prepare pnpm@10.5.0 --activate

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git openssl \
 && rm -rf /var/lib/apt/lists/*

RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "aarch64" || echo "x86_64") \
 && curl -sSL "https://github.com/bufbuild/buf/releases/download/v1.45.0/buf-Linux-${ARCH}" -o /usr/local/bin/buf \
 && chmod +x /usr/local/bin/buf

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm proto:generate
RUN pnpm build
RUN pnpm prune --prod

FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    DOCKER_RUNNER_GRPC_HOST=0.0.0.0 \
    DOCKER_RUNNER_PORT=50051

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=base --chown=node:node /app/package.json /app/package.json
COPY --from=base --chown=node:node /app/node_modules /app/node_modules
COPY --from=base --chown=node:node /app/dist /app/dist

USER node

EXPOSE 50051

CMD ["node", "dist/service/main.js"]
