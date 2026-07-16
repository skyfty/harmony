# syntax=docker/dockerfile:1

# --- Build Stage ---
FROM node:20-alpine AS build

WORKDIR /app/editor
ENV NODE_ENV=development
RUN corepack enable

ENV PNPM_VERSION=10.28.2
ENV NPM_REGISTRY_URL=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY_URL}

# Install pnpm globally using the mirror.
RUN rm -f /usr/local/bin/pnpm || true && npm install -g pnpm@${PNPM_VERSION} --registry=${NPM_REGISTRY_URL} --force

# Bring in local packages that editor and schema depend on via file:../ paths.
COPY editor/package.json editor/pnpm-lock.yaml ./
COPY schema/package.json /app/schema/package.json
COPY scripts /app/scripts
COPY scenery /app/scenery
COPY utils /app/utils
COPY physics-core /app/physics-core
COPY physics-bridge /app/physics-bridge
COPY physics-ammo /app/physics-ammo
COPY physics-cannon /app/physics-cannon
COPY tools /app/tools

# Ensure pnpm uses the mirror for all installs in the container.
RUN echo "registry=${NPM_REGISTRY_URL}" > /app/.npmrc && echo "registry=${NPM_REGISTRY_URL}" > /root/.npmrc

# Build local tools and physics packages first so downstream packages can resolve
# their published types from dist/.
RUN pnpm --dir /app/tools install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/tools run build
RUN pnpm --dir /app/physics-core install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/physics-core run build
RUN pnpm --dir /app/physics-bridge install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/physics-bridge run build
RUN pnpm --dir /app/physics-ammo install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/physics-ammo run build
RUN pnpm --dir /app/physics-cannon install --frozen-lockfile --registry=${NPM_REGISTRY_URL} && pnpm --dir /app/physics-cannon run build

# Install editor dependencies.
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY_URL}

# Make sure /app exists for schema resolution via parent node_modules.
RUN [ -e /app/node_modules ] || ln -s /app/editor/node_modules /app/node_modules

# Copy the full editor source and schema source.
COPY editor/ ./
COPY schema/ /app/schema/

# Ensure editor's @harmony/schema points at the full schema source tree.
RUN rm -rf /app/editor/node_modules/@harmony/schema && ln -s /app/schema /app/editor/node_modules/@harmony/schema

# Install and build schema so its exports exist during editor type-check/build.
RUN pnpm --dir /app/schema install --frozen-lockfile --registry=${NPM_REGISTRY_URL}
RUN pnpm --dir /app/schema run build

# Build the editor app.
RUN pnpm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime

WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY --from=build /app/editor/dist ./
RUN mkdir -p /usr/share/nginx/html/config
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '' \
  '  gzip on;' \
  '  gzip_types text/plain text/css application/json application/javascript application/xml+rss application/xml text/javascript image/svg+xml;' \
  '' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' \
  > /etc/nginx/conf.d/default.conf
EXPOSE 80
# Write the pid file to /tmp so the container does not need write access to /run.
CMD ["nginx", "-g", "pid /tmp/nginx.pid; daemon off;"]
