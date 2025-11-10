# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html
# 清空默认静态资源
RUN rm -rf ./*
# 拷贝构建产物
COPY --from=build /app/dist ./
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
