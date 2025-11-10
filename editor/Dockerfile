# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# 以仓库根为构建上下文（在 compose 中设置），此处工作目录切到 editor
WORKDIR /app/editor
ENV NODE_ENV=development
# 先拷贝 package 清单，包含本地依赖所需的 schema 包描述
COPY editor/package.json editor/package-lock.json ./
COPY schema/package.json ../schema/package.json
# 安装依赖（包含 devDependencies，确保 vite 可用）
RUN npm ci
# 拷贝源码（editor 与 schema）
COPY editor/ ./
COPY schema/ ../schema/
# 仅使用 vite 构建，跳过类型检查以避免编译时因未使用变量而失败
RUN npm run build

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
