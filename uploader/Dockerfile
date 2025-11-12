# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
# 在 docker-compose 中以仓库根目录作为构建上下文
WORKDIR /app/uploader
ENV NODE_ENV=development
# 拷贝 package 信息及 schema 描述文件
COPY uploader/package*.json ./
COPY schema/package.json ../schema/package.json
# 安装依赖，若存在 lock 文件则优先使用 npm ci
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# 拷贝源码（uploader 与 schema）
COPY uploader/ ./
COPY schema/ ../schema/
# 构建静态资源
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
