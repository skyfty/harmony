# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# 使用仓库根为构建上下文（由 compose 指定），此处切到 admin 目录
WORKDIR /app/admin
ENV NODE_ENV=development
# 先拷贝 package 清单，包含本地依赖所需的 schema 包描述
COPY admin/package.json admin/package-lock.json ./
COPY schema/package.json ../schema/package.json
# 安装依赖（包含 devDependencies，确保 vite/vue-tsc 可用）
RUN npm ci

# TypeScript also type-checks files from /app/schema (via file:../schema).
# Node-style module resolution from /app/schema walks up to /app/node_modules,
# so expose the admin's node_modules there for the build.
RUN [ -e /app/node_modules ] || ln -s /app/admin/node_modules /app/node_modules

# 拷贝源码（admin 与 schema）
COPY admin/ ./
COPY schema/ ../schema/
# 确保依赖实际指向完整 schema 源码（安装阶段仅拷贝了 schema/package.json）
RUN rm -rf /app/admin/node_modules/@harmony/schema && ln -s /app/schema /app/admin/node_modules/@harmony/schema
# 安装 schema 自身依赖（schema/node_modules 不会随 Docker 上下文拷贝）
RUN npm --prefix /app/schema ci
# 先构建 schema（生成 dist/ 供 @harmony/schema 的 exports 使用）
RUN npm --prefix /app/schema run build
# 构建产物
RUN npm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html
# 清空默认静态资源
RUN rm -rf ./*
# 拷贝构建产物
COPY --from=build /app/admin/dist ./
# 提供运行时配置目录，挂载 config 卷可覆盖
RUN mkdir -p /usr/share/nginx/html/config
# 拷贝自定义 nginx 配置（开启 gzip、缓存等）
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
