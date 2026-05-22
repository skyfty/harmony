# syntax=docker/dockerfile:1

# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

RUN corepack enable

ENV PNPM_VERSION=10.28.2
ENV NPM_REGISTRY_URL=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY_URL}

# Install pnpm from the mirror so the container build is less likely to time out.
RUN rm -f /usr/local/bin/pnpm || true && npm install -g pnpm@${PNPM_VERSION} --registry=${NPM_REGISTRY_URL} --force

# Bring in the full monorepo so tour can resolve its local file:../ dependencies
# and run the bootstrap helpers that prepare H5 assets.
COPY . .

# Keep all package installs on the mirror.
RUN echo "registry=${NPM_REGISTRY_URL}" > /app/.npmrc && echo "registry=${NPM_REGISTRY_URL}" > /root/.npmrc

WORKDIR /app/tour

# This runs the tour prebuild bootstrap first, then builds the H5 bundle.
RUN pnpm run build:h5
RUN test -f /app/tour/dist/build/h5/index.html

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

RUN rm -rf ./*
COPY --from=build /app/tour/dist/build/h5 ./

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
CMD ["nginx", "-g", "daemon off;"]
