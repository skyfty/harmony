# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# 以仓库根为构建上下文（在 compose 中设置），此处工作目录切到 editor
WORKDIR /app/editor
ENV NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# 先拷贝 package 清单，包含本地依赖所需的 schema 包描述
COPY editor/package.json editor/pnpm-lock.yaml ./
COPY schema/package.json ../schema/package.json
# Bring in local tools package so schema's file:../tools can be resolved
COPY tools ./tools
# Install and build local tools package so its `dist` and `bin` exist (if needed)
RUN pnpm --dir /app/tools install --frozen-lockfile && pnpm --dir /app/tools run build
# 安装依赖（包含 devDependencies，确保 vite 可用）
RUN pnpm install --frozen-lockfile

# Schema sources live at /app/schema; it resolves node_modules by walking up to /app/node_modules.
RUN [ -e /app/node_modules ] || ln -s /app/editor/node_modules /app/node_modules
# 拷贝源码（editor 与 schema）
COPY editor/ ./
COPY schema/ ../schema/
# 确保依赖实际指向完整 schema 源码（安装阶段仅拷贝了 schema/package.json）
RUN rm -rf /app/editor/node_modules/@harmony/schema && ln -s /app/schema /app/editor/node_modules/@harmony/schema
# 安装 schema 自身依赖（schema/node_modules 不会随 Docker 上下文拷贝）
RUN pnpm --dir /app/schema install --frozen-lockfile
# 先构建 schema（生成 dist/ 供 @harmony/schema 的 exports 使用）
RUN pnpm --dir /app/schema run build
# 仅使用 vite 构建，跳过类型检查以避免编译时因未使用变量而失败
RUN pnpm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY --from=build /app/editor/dist ./
RUN mkdir -p /usr/share/nginx/html/config
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
