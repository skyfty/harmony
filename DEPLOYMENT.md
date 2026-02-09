# Harmony 全栈生产部署指南 (server / admin / editor / uploader)

本指南覆盖以下子工程的生产部署、升级与回滚流程：
- `server`：Koa + Mongo，API 与资源上传（域名：`v.touchmagic.cn` 用于静态与 API 反代）。
- `admin`：后台管理前端（域名：`admin.v.touchmagic.cn`）。
- `editor`：场景/编辑器前端（域名：`editor.v.touchmagic.cn`）。
- `uploader`：独立资源上传前端（域名建议如 `uploader.v.touchmagic.cn`）。

特点：
- 所有服务通过 Docker Compose 编排。
- Mongo 与上传目录使用宿主机持久化绑定。
- 前端运行时配置不写死后端地址，通过挂载 `config/app-config.json` 实现环境切换。
- 升级采用原地重建镜像 + 无状态前端替换；数据与配置不丢失。

## 一、前置条件
1. 已解析域名：在域名服务商控制台添加 `v.touchmagic.cn` A 记录指向服务器公网 IP。
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

### 方式 A：本地构建镜像后上传（服务器无需 git clone）
1. 在本地开发机（已确认各子工程可以正常构建）执行：
   ```bash
   # 在仓库根目录
   docker build -t harmony-server:prod ./server
   docker build -t harmony-admin:prod ./admin
   docker build -t harmony-editor:prod -f editor/Dockerfile .
   docker build -t harmony-uploader:prod -f uploader/Dockerfile .
   docker save -o harmony-prod-images.tar \
     harmony-server:prod harmony-admin:prod harmony-editor:prod harmony-uploader:prod
   ```
2. 将 `harmony-prod-images.tar` 通过安全方式上传到生产服务器，例如：
   ```bash
   scp harmony-prod-images.tar user@your-server:/opt/
   ```
3. 在生产服务器导入镜像并准备目录结构：
   ```bash
   cd /opt
  sudo docker load -i harmony-prod-images.tar
  sudo mkdir -p /opt/harmony/server /opt/harmony/config
   ```
4. 将仓库中的 `docker-compose.prod.yml`、`server/.env.production` 及所需的前端运行时配置文件拷贝到服务器（若服务器无法直接访问仓库，可先在本地打包相关文件再上传）：
   ```bash
   scp docker-compose.prod.yml user@your-server:/opt/harmony/
   scp server/.env.production user@your-server:/opt/harmony/server/
   scp admin/public/config/app-config.example.json user@your-server:/opt/harmony/config/admin-app-config.json
   scp editor/public/config/app-config.example.json user@your-server:/opt/harmony/config/editor-app-config.json
   scp uploader/public/config/app-config.example.json user@your-server:/opt/harmony/config/uploader-app-config.json
   ```
5. 在服务器上将 `docker-compose.prod.yml` 中各服务的 `build` 字段替换为已上传镜像标签，例如：
   ```yaml
   services:
     server:
       image: harmony-server:prod
       # ...其他字段保持不变
     admin:
       image: harmony-admin:prod
     editor:
       image: harmony-editor:prod
     uploader:
       image: harmony-uploader:prod
   ```
   > 可以直接编辑文件，或额外创建 `docker-compose.override.images.yml` 仅覆盖上述服务配置。
6. 修改完 `.env.production` 及运行时配置后，即可参考“六、构建与启动”中的命令使用现有镜像启动。

### 方式 B：在服务器上克隆仓库（如允许 git）
```bash
# 克隆仓库（替换为你的实际仓库地址，如使用 git@ 需先配置 SSH KEY）
cd /opt
sudo git clone https://github.com/skyfty/harmony.git
cd harmony
```

## 四、配置环境变量

所有需要的环境文件已经随仓库提供，请按环境修改数值后再部署。

### server（`server/.env.development` / `server/.env.production`）
- `NODE_ENV`：固定为 `development`/`production`，用于区分环境。
- `PORT`：Koa 服务监听端口，默认 `4000`。
- `MONGODB_URI`：Mongo 连接串。开发版指向本地，生产版指向 compose 内部 `mongo` 服务。
- `JWT_SECRET`：JWT 密钥，**生产环境务必改为强随机值**。
- `ASSET_STORAGE_PATH`：服务器内的上传目录位置。
- `ASSET_PUBLIC_URL`：上传资源对外访问地址，需要与反向代理保持一致。
- `EDITOR_PUBLIC_URL`：允许通过 CORS 访问的前端站点。
- `TEST_USER_*`：用于 `npm run seed` 时生成的测试账号，可留空取消。
- `UPLOADER_USER_*`：自动生成 uploader 登录账号的配置。
- `OPENAI_*`：可选的 OpenAI 配置，如未使用可以留空。

> 部署前：进入 `server/` 修改 `.env.production`，至少更新 `JWT_SECRET`、数据库地址以及 OpenAI 密钥（如需）。本地开发可根据需要调整 `.env.development`。

### admin（`admin/.env.development` / `admin/.env.production`）
- `VITE_API_BASE_URL`：后台前端访问后端的基础地址。开发版指向 `http://localhost:4000`，生产版改为生产域名（通常为 `https://v.touchmagic.cn`）。

### editor（`editor/.env.development` / `editor/.env.production`）
- `VITE_SERVER_API_BASE_URL`：编辑器访问 API 的域名。
- `VITE_SERVER_API_PREFIX`：后端 API 前缀，默认为 `/api`。

### uploader（`uploader/.env.development` / `uploader/.env.production`）
- `VITE_API_BASE_URL`：上传前端访问后端的基础地址。
- `VITE_API_PREFIX`：API 前缀，默认为 `/api`。

### exhibition（`exhibition/.env.development` / `exhibition/.env.production`）
- `VITE_MINI_API_BASE`：展览主题小程序调用后端的完整基础路径，默认包含 `/api/mini`。

### scene-viewer（`scene-viewer/.env.development` / `scene-viewer/.env.production`）
- `VITE_MINI_API_BASE`：3D 场景 viewer（独立工程 + 可复用 `uni_modules/scene-viewer` 分包）调用后端的完整基础路径，默认包含 `/api/mini`。

> 开发阶段保持默认即可连接本地 `http://localhost:4000`，上线前请将生产配置中的域名更新为实际部署域名并确认 HTTPS（当前小程序侧仅支持微信小程序构建）。

关键变量提醒：
- `MONGODB_URI=mongodb://mongo:27017/harmony`：容器内部使用服务名 `mongo` 与其内部端口 27017，不受宿主机映射影响。
- `ASSET_PUBLIC_URL=https://v.touchmagic.cn/uploads`：用于上传资源外链访问；反向代理需对应配置路径 `/uploads`。
- `UPLOADER_USER_USERNAME` / `UPLOADER_USER_PASSWORD` / `UPLOADER_USER_DISPLAY_NAME`：确保 uploader 服务拥有独立账号，生产环境请改为强密码。

### 初始化默认账号 / 基础数据

`server` 项目提供 `npm run seed` 与 `npm run seed:prod` 用于创建默认管理员、测试账号、uploader 账号及部分示例数据。建议在首次部署与更改默认账号配置后执行一次：

```bash
# 在仓库根目录（已安装依赖）
cd server
npm install # 首次部署若未安装
npm run seed        # 使用 .env.development（本地测试）
npm run seed:prod   # 使用 .env.production（生产环境）

# 如果通过 Docker 部署，可在服务器上执行（compose 方式）：
docker compose -f docker-compose.prod.yml run --rm server npm run seed:prod
```

该脚本会调用：
- `createInitialAdmin()`：生成超级管理员账号 `admin`（默认密码 `admin123`，请登录后修改）。
- `ensureEditorUser()`：生成测试账号（默认来自 `EDITOR_USER_*`）。
- `ensureUploaderUser()`：生成 uploader 使用的专用账号（默认来自 `UPLOADER_USER_*`）。

## 五、目录与 docker-compose 结构
`docker-compose.prod.yml` 关键点：

| 服务 | 作用 | 端口 (宿主→容器) | 挂载/持久化 | 备注 |
|------|------|------------------|-------------|------|
| mongo | 数据库 | 27018→27017 | `/www/web/v_touchmagic_cn/harmony/server/mongo-data:/data/db` | 避免与系统已有 Mongo 冲突 |
| server | 后端 API & 上传 | 4000→4000 | `/www/web/v_touchmagic_cn/harmony/server/uploads:/app/uploads` | Koa 应用，反代暴露 |
| admin | 管理前端 | 8087→80 | `/www/web/v_touchmagic_cn/harmony/config/admin-app-config.json:/usr/share/nginx/html/config/app-config.json:ro` | 运行时配置文件 |
| editor | 编辑器前端 | 8088→80 | `/www/web/v_touchmagic_cn/harmony/config/editor-app-config.json:/usr/share/nginx/html/config/app-config.json:ro` | 运行时配置文件 |
| uploader | 上传前端 | 8090→80 | `/www/web/v_touchmagic_cn/harmony/config/uploader-app-config.json:/usr/share/nginx/html/config/app-config.json:ro` | 运行时配置文件 |

前端运行时配置文件示例（宿主机路径）：
`/www/web/v_touchmagic_cn/harmony/config/admin-app-config.json`
```json
{
  "serverApiBaseUrl": "https://v.touchmagic.cn",
  "serverApiPrefix": "/api",
  "assetPublicBaseUrl": "https://v.touchmagic.cn/uploads"
}
```
`editor`、`uploader` 同理，可视业务需要分别配置。例如 `uploader`：

`/www/web/v_touchmagic_cn/harmony/config/uploader-app-config.json`
```json
{
  "serverApiBaseUrl": "https://v.touchmagic.cn",
  "serverApiPrefix": "/api"
}
```

## 六、首次构建与启动

根据你选择的获取方式不同，执行其一：

### 若使用方式 A（预构建镜像部署）
```bash
# 在服务器上，进入包含 docker-compose.prod.yml 的目录（例如 /opt/harmony）
# 如有镜像覆盖文件，追加 -f docker-compose.override.images.yml
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### 若使用方式 B（服务器上可 git clone）
```bash
# 在仓库根目录
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

如需仅启动后端与数据库，可针对 `server` 与 `mongo` 服务单独执行：
```bash
docker compose -f docker-compose.prod.yml build server mongo editor 
docker compose -f docker-compose.prod.yml up -d server mongo editor
docker compose -f docker-compose.prod.yml ps server mongo editor
```

日志查看：
```bash
docker compose -f docker-compose.prod.yml logs -f server
docker compose -f docker-compose.prod.yml logs -f mongo
docker compose -f docker-compose.prod.yml logs -f admin
docker compose -f docker-compose.prod.yml logs -f editor
docker compose -f docker-compose.prod.yml logs -f uploader
```

## 七、数据与备份策略
- Mongo 数据：卷 `mongo_data` 对应 `/var/lib/docker/volumes/.../` 路径，可使用 `mongodump` 进入容器备份：
```bash
docker exec -it harmony-mongo sh -c 'apt-get update && apt-get install -y mongodb-database-tools && mongodump --out /data/db-dump'
```
将备份目录打包复制至宿主机再上传对象存储。

## 八、反向代理与 HTTPS（Nginx / Caddy）
可以使用 Nginx 或 Caddy，这里给出两种示例。

### 选项 A：Nginx
1. 安装 Nginx：`sudo apt install -y nginx`。
2. 安装 Certbot 获取证书：
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d v.touchmagic.cn --redirect --hsts --staple-ocsp --email admin@example.com --agree-tos --no-eff-email
```
3. 建立站点配置 `/etc/nginx/sites-available/harmony-sites.conf`：
```nginx
server {
  listen 80;
  listen 443 ssl http2; # certbot 将自动插入 ssl 证书指令
  server_name v.touchmagic.cn;

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
    proxy_pass http://127.0.0.1:8087/;
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
    proxy_pass http://127.0.0.1:8088/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  listen 443 ssl http2;
  server_name uploader.v.touchmagic.cn;

  client_max_body_size 100m;

  location / {
    proxy_pass http://127.0.0.1:8090/;
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

## 九、验证部署 (API / 静态 / 前端)
```bash
curl -I https://v.touchmagic.cn/uploads/非存在文件
# 期望 404
curl -I https://v.touchmagic.cn/uploads/实际文件名
# 期望 200 并带缓存头

curl -I https://admin.v.touchmagic.cn/
curl -I https://editor.v.touchmagic.cn/
curl -I https://uploader.v.touchmagic.cn/
```
查看应用日志确认启动：`Server listening on http://localhost:4000`。

## 十、升级流程（全量或单服务）

### 1. 拉取代码
```bash
cd /opt/harmony
git pull --ff-only
```

### 2. 仅升级后端 server
```bash
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```

### 3. 升级全部（server + admin + editor）
```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### 4. 查看变更后的运行状态
```bash
docker compose -f docker-compose.prod.yml ps
```

### 5. 热修前端仅替换配置文件（无需重建）
直接编辑宿主机：
`/www/web/v_touchmagic_cn/harmony/config/admin-app-config.json`
`/www/web/v_touchmagic_cn/harmony/config/editor-app-config.json`
前端将按页面刷新后加载新的后端地址。

### 6. 回滚
```bash
git checkout <TAG_OR_COMMIT>
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

可选：为每次生产部署打标签：
```bash
git tag -a prod-$(date +%Y%m%d-%H%M) -m "prod deploy"
git push --tags
```

## 十一、安全加固建议
1. 使用随机且足够长度的 `JWT_SECRET`，变更后需使旧 Token 失效（可改密钥 + 重启）。
2. 防火墙放通端口：80/443/22（可选 27018），限制 4000/8081/8082 仅本地访问。
3. 前端只通过挂载配置文件引用后端地址，不在打包时写死，降低误发生产风险。
4. 定期：
  - `mongodump` 结构与数据（或使用增量备份策略）
  - 归档 `/www/web/v_touchmagic_cn/harmony/server/uploads`（可对大文件做对象存储迁移）
5. 配置最小权限系统用户运行 Docker（避免 root 直接操作业务文件）。
6. 监控：接入容器 metrics（可选 Prometheus + cAdvisor）与 Nginx/Caddy 访问日志轮转。

## 十二、常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| 访问超时 | 反向代理未指向 4000 | 检查 Nginx/Caddy 配置并重载 |
| 上传返回 403 | 路径穿越被阻止 | 确认请求路径未包含 `..` 或未 URL 编码异常 |
| 端口冲突 | 宿主已有 Mongo 27017 | 使用 27018:27017 映射（已配置） |
| 证书续期失败 | DNS 解析或防火墙限制 | 放通 80/443 并检查域名解析 |
| 服务启动报 `ERR_MODULE_NOT_FOUND: Cannot find package '@/...'` | TypeScript 路径别名未在编译产物中重写 | 已在 `server/Dockerfile` 中增加 `npx tsc-alias -p tsconfig.json`，重新构建并启动：`docker compose -f docker-compose.prod.yml build server && docker compose -f docker-compose.prod.yml up -d server` |

## 十三、快速一键首次部署脚本示例 (可选)
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR=/opt/harmony
if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/skyfty/harmony.git "$REPO_DIR"
fi
cd "$REPO_DIR"
SECRET=$(openssl rand -hex 32)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" server/.env.production
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```
> 使用前请先确认脚本中仓库地址与变量是否符合你的实际情况。

---
如需集成对象存储 (OSS / S3) 或分离 Mongo 到托管服务，可在下次迭代中扩展。欢迎继续提出需求。
