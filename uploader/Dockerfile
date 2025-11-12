# syntax=docker/dockerfile:1
# --- Build Stage ---
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# --- Runtime Stage ---
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY --from=build /app/dist ./
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
