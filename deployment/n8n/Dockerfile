ARG NODE_VERSION=26.10.0

# Build the checked-in n8n fork. The resulting runtime is therefore produced
# from vendor/n8n rather than copied from the upstream prebuilt n8n image.
FROM node:${NODE_VERSION}-alpine3.24 AS fork-builder

RUN apk add --no-cache bash git python3 make g++
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry ${NPM_REGISTRY} && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --global pnpm@12.4.2

WORKDIR /src/n8n
COPY vendor/n8n ./

ENV CI=true
RUN --mount=type=cache,id=cliptora-n8n-pnpm,target=/pnpm/store \
    --mount=type=cache,id=cliptora-n8n-turbo,target=/src/n8n/.turbo \
    pnpm config set registry ${NPM_REGISTRY} && \
    pnpm config set store-dir /pnpm/store && \
    node scripts/ensure-zx.mjs && \
    node scripts/build-n8n.mjs

# Keep n8n's official runtime wrapper, but replace the application payload with
# the production closure compiled above from the CLIPTORA-maintained source.
FROM n8nio/n8n:2.45.0
USER root
RUN rm -rf /usr/local/lib/node_modules/n8n
COPY --from=fork-builder /src/n8n/compiled /usr/local/lib/node_modules/n8n
COPY integrations/n8n-nodes-cliptora /opt/cliptora-nodes
COPY deployment/n8n/bootstrap-api-key.cjs /opt/cliptora/bootstrap-api-key.cjs
# The repository is checked out on Windows. Normalize the executable launcher
# because a CRLF shebang is interpreted as an executable named `node\r` on Linux.
RUN sed -i 's/\r$//' /usr/local/lib/node_modules/n8n/bin/n8n && \
    chown -R node:node /opt/cliptora-nodes /opt/cliptora
ENV N8N_CUSTOM_EXTENSIONS=/opt/cliptora-nodes
USER node

LABEL org.opencontainers.image.title="CLIPTORA n8n fork" \
      org.opencontainers.image.version="2.45.0-cliptora" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n/tree/n8n%402.45.0" \
      com.cliptora.n8n.upstream-commit="7c79fd09a04e256a6b14bf29a40355a73a17d79d"
