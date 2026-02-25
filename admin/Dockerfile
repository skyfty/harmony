# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app/admin
ENV NODE_ENV=development

RUN corepack enable

# Use a fixed pnpm version and a faster registry mirror to avoid timeouts
ENV PNPM_VERSION=10.28.2
ENV NPM_REGISTRY_URL=https://registry.npmmirror.com

# Install pnpm globally using the mirror (avoid existing symlink causing EEXIST)
# Remove existing pnpm binary if present, then install and force overwrite.
RUN rm -f /usr/local/bin/pnpm || true && npm install -g pnpm@${PNPM_VERSION} --registry=${NPM_REGISTRY_URL} --force

COPY admin/ ./

# Ensure pnpm uses the mirror for all installs in the container
RUN echo "registry=${NPM_REGISTRY_URL}" > .npmrc

RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY_URL}
RUN pnpm -F @vben/web-antd run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

RUN rm -rf ./*
COPY --from=build /app/admin/apps/web-antd/dist ./

# 默认生产配置（可被 compose 挂载的 /usr/share/nginx/html/_app.config.js 覆盖）
COPY <<'EOF' /usr/share/nginx/html/_app.config.js
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_GLOB_API_URL: 'https://v.touchmagic.cn/api',
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: ''
};
Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_);
Object.defineProperty(window, '_VBEN_ADMIN_PRO_APP_CONF_', {
  configurable: false,
  writable: false,
});
EOF

COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript application/xml+rss application/xml text/javascript image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
