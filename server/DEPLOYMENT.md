# Harmony Server 生产部署指南 (cdn.touchmagic.cn)

本文档说明如何将 `server` 子工程通过 Docker 部署到生产环境，并使用域名 `cdn.touchmagic.cn` 暴露静态上传资源与 API。假设服务器已安装其他服务，并且默认的 MongoDB 27017 端口被占用，我们将宿主机改用 27018 端口映射。

## 一、前置条件
1. 已解析域名：在域名服务商控制台添加 `cdn.touchmagic.cn` A 记录指向服务器公网 IP。
2. 服务器操作系统：Linux (Ubuntu/CentOS 等)。
3. 已拥有具备 sudo 权限的 SSH 账号。
4. 服务器已安装或即将安装 Docker 与 Docker Compose（v2）。

## 二、安装 Docker 与 Compose
```bash
# Ubuntu 示例
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
# 验证
docker version
# 若未自带 compose 插件，可安装：
sudo apt-get install -y docker-compose-plugin
```

## 三、获取代码（两种方式）

### 方式 A：本地打包后在服务器部署（不使用 git clone）
1. 在你的本地开发机（已能构建成功的环境）执行：
  ```bash
  # 在仓库根目录（包含 server/）
  docker build -t harmony-server:prod ./server
  docker save harmony-server:prod -o harmony-server-prod.tar
  ```
2. 将 `harmony-server-prod.tar` 通过安全方式上传到生产服务器，例如：
  ```bash
  scp harmony-server-prod.tar user@your-server:/opt/
  ```
3. 在生产服务器上导入镜像并准备目录结构：
  ```bash
  cd /opt
  sudo docker load -i harmony-server-prod.tar
  # 创建部署目录（包含 compose 与 env 文件）
  sudo mkdir -p /opt/harmony/server
  ```
4. 将本地的 `docker-compose.image.yml` 与 `server/.env.production` 上传到服务器对应目录：
  ```bash
  # 假设你在本地仓库根目录
  scp docker-compose.image.yml user@your-server:/opt/harmony/
  scp server/.env.production user@your-server:/opt/harmony/server/
  ```
5. 在服务器启动（见“六、构建与启动”中使用 image 方案的命令）。

### 方式 B：在服务器上克隆仓库（如允许 git）
```bash
# 克隆仓库（替换为你的实际仓库地址，如使用 git@ 需先配置 SSH KEY）
cd /opt
sudo git clone https://github.com/skyfty/harmony.git
cd harmony
```

## 四、配置环境变量
复制示例文件并编辑：
```bash
cd server
cp .env.production.example .env.production
nano .env.production
# 修改 JWT_SECRET 为强随机值
# 若需要自定义编辑器域名，调整 EDITOR_PUBLIC_URL
```

关键变量说明：
- `MONGODB_URI=mongodb://mongo:27017/harmony`：容器内部使用服务名 `mongo` 与其内部端口 27017，不受宿主机映射影响。
- `ASSET_PUBLIC_URL=https://cdn.touchmagic.cn/uploads`：用于上传资源外链访问；反向代理需对应配置路径 `/uploads`。

## 五、docker-compose 文件结构
根目录已经创建 `docker-compose.prod.yml`：
- `mongo` 服务：容器端口 27017，宿主机映射到 27018；数据目录绑定到宿主机 `/www/web/v_touchmagic_cn/harmony/server/mongo-data:/data/db`。
- `server` 服务：构建自 `server/Dockerfile`，上传目录绑定到宿主机 `/www/web/v_touchmagic_cn/harmony/server/uploads:/app/uploads`。
- `admin` 服务：构建自 `admin/Dockerfile`，对外端口 8081；通过挂载 `/usr/share/nginx/html/config/app-config.json` 实现运行时配置。
- `editor` 服务：构建自 `editor/Dockerfile`，对外端口 8082；同样支持运行时配置。

## 六、构建与启动

根据你选择的获取方式不同，执行其一：

### 若使用方式 A（预构建镜像部署）
```bash
# 在服务器上，进入包含 docker-compose.image.yml 的目录（例如 /opt/harmony）
docker compose -f docker-compose.image.yml up -d
docker compose -f docker-compose.image.yml ps
```

### 若使用方式 B（服务器上可 git clone）
```bash
# 在仓库根目录
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

日志查看：
```bash
docker compose -f docker-compose.prod.yml logs -f server
docker compose -f docker-compose.prod.yml logs -f mongo
```

## 七、数据与备份
- Mongo 数据：卷 `mongo_data` 对应 `/var/lib/docker/volumes/.../` 路径，可使用 `mongodump` 进入容器备份：
```bash
docker exec -it harmony-mongo sh -c 'apt-get update && apt-get install -y mongodb-database-tools && mongodump --out /data/db-dump'
```
将备份目录打包复制至宿主机再上传对象存储。

## 八、反向代理与 HTTPS
可以使用 Nginx 或 Caddy，这里给出两种示例。

### 选项 A：Nginx
1. 安装 Nginx：`sudo apt install -y nginx`。
2. 安装 Certbot 获取证书：
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cdn.touchmagic.cn --redirect --hsts --staple-ocsp --email admin@example.com --agree-tos --no-eff-email
```
3. 建立站点配置 `/etc/nginx/sites-available/harmony-sites.conf`：
```nginx
server {
  listen 80;
  listen 443 ssl http2; # certbot 将自动插入 ssl 证书指令
  server_name cdn.touchmagic.cn;

  client_max_body_size 100m;

  location /uploads/ {
    proxy_pass http://127.0.0.1:4000/uploads/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 根据需要调整缓存头，这里让应用本身决定 Cache-Control
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  listen 443 ssl http2;
  server_name admin.v.touchmagic.cn;

  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:8081/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  listen 443 ssl http2;
  server_name editor.v.touchmagic.cn;

  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:8082/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
4. 启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/harmony-sites.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 选项 B：Caddy（更简单自动证书）
1. 安装：
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy -y
```
2. 编辑 `/etc/caddy/Caddyfile`：
```
cdn.touchmagic.cn {
  encode gzip
  handle /uploads/* {
    reverse_proxy 127.0.0.1:4000
  }
  handle /api/* {
    reverse_proxy 127.0.0.1:4000
  }
  log {
    output file /var/log/caddy/cdn.access.log
  }
}

admin.v.touchmagic.cn {
  encode gzip
  reverse_proxy 127.0.0.1:8081
  log {
    output file /var/log/caddy/admin.access.log
  }
}

editor.v.touchmagic.cn {
  encode gzip
  reverse_proxy 127.0.0.1:8082
  log {
    output file /var/log/caddy/editor.access.log
  }
}
```
3. 重载：`sudo systemctl reload caddy`

> 注意：如果 API 路由前缀并非 `/api`，需要根据实际 `routes` 修改；静态上传目录前缀由 `ASSET_PUBLIC_URL` 中的路径决定（示例为 `/uploads`）。

## 九、验证部署
```bash
curl -I https://cdn.touchmagic.cn/uploads/非存在文件
# 期望 404
curl -I https://cdn.touchmagic.cn/uploads/实际文件名
# 期望 200 并带缓存头

curl -I https://admin.v.touchmagic.cn/
curl -I https://editor.v.touchmagic.cn/
```
查看应用日志确认启动：`Server listening on http://localhost:4000`。

## 十、升级与回滚
升级：
```bash
cd /opt/harmony
git pull
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```
回滚：使用 `git checkout <旧标签>` 后重新 build & up。

## 十一、安全加固建议
- 使用随机且足够长度的 `JWT_SECRET`。
 - 配置防火墙仅放通 80/443，内部端口 4000/8081/8082 仅供本机反向代理访问。
 - 不在前端镜像内直接写死后端地址，通过挂载 `config/app-config.json` 实现运行时切换环境。
- 限制防火墙仅开放 80/443/22/27018（若需宿主访问 Mongo）。
- 定期 `mongodump` 做异地备份。
- 若上传目录有执行风险，保持仅存放二进制/图片/模型文件。

## 十二、常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| 访问超时 | 反向代理未指向 4000 | 检查 Nginx/Caddy 配置并重载 |
| 上传返回 403 | 路径穿越被阻止 | 确认请求路径未包含 `..` 或未 URL 编码异常 |
| 端口冲突 | 宿主已有 Mongo 27017 | 使用 27018:27017 映射（已配置） |
| 证书续期失败 | DNS 解析或防火墙限制 | 放通 80/443 并检查域名解析 |

## 十三、快速一键脚本示例 (可选)
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR=/opt/harmony
if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/skyfty/harmony.git "$REPO_DIR"
fi
cd "$REPO_DIR"
cp server/.env.production.example server/.env.production
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" server/.env.production
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```
> 使用前请先确认脚本中仓库地址与变量是否符合你的实际情况。

---
如需集成对象存储 (OSS / S3) 或分离 Mongo 到托管服务，可在下次迭代中扩展。欢迎继续提出需求。
