# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# 使用仓库根为构建上下文（在 compose 中设置），此处切到 uploader 目录
WORKDIR /app/uploader
ENV NODE_ENV=development
# 先拷贝 package 清单，包含本地依赖所需的 schema 包描述
COPY uploader/package.json uploader/package-lock.json ./
COPY schema/package.json ../schema/package.json
# 安装依赖（包含 devDependencies，确保 vue-tsc/vite 可用）
RUN npm install --legacy-peer-deps

# TypeScript also type-checks files from /app/schema (via file:../schema).
# Node-style module resolution from /app/schema walks up to /app/node_modules,
# so expose the uploader's node_modules there for the build.
RUN [ -e /app/node_modules ] || ln -s /app/uploader/node_modules /app/node_modules
# 拷贝源码（uploader 与 schema）
COPY uploader/ ./
COPY schema/ ../schema/
# 确保依赖实际指向完整 schema 源码（安装阶段仅拷贝了 schema/package.json）
RUN rm -rf /app/uploader/node_modules/@harmony/schema && ln -s /app/schema /app/uploader/node_modules/@harmony/schema
# 先构建 schema（生成 dist/ 供 @harmony/schema 的 exports 使用）
RUN npm --prefix /app/schema run build
# 构建产物
RUN npm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY --from=build /app/uploader/dist ./
RUN mkdir -p /usr/share/nginx/html/config
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;

  root   /usr/share/nginx/html;
  index  index.html;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript application/xml+rss application/xml text/javascript image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
EOF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
