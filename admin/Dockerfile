# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app/admin
ENV NODE_ENV=development

RUN corepack enable

COPY admin/ ./

RUN pnpm install --frozen-lockfile
RUN pnpm -F @vben/web-antd run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

RUN rm -rf ./*
COPY --from=build /app/admin/apps/web-antd/dist ./

# 默认生产配置（可被 compose 挂载的 /usr/share/nginx/html/_app.config.js 覆盖）
COPY <<'EOF' /usr/share/nginx/html/_app.config.js
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_GLOB_API_URL: 'http://v.touchmagic.cn/api',
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
