# Harmony 生产部署指南（2026 新逻辑）

本文档覆盖 Harmony 单仓库的生产部署、升级、回滚与发布流程，按当前源码结构与运行机制重构。

## 0. 范围与边界

### 0.1 本文覆盖的生产服务（Docker Compose）
- `mongo`：数据库（持久化到宿主机目录）。
- `server`：Koa API + 上传资源静态服务 + 多人协同 WS 服务。
- `admin`：后台管理前端（生产配置基准：`window._VBEN_ADMIN_PRO_APP_CONF_`）。
- `editor`：编辑器前端（生产配置基准：`/config/app-config.json`）。
- `uploader`：上传前端（生产配置基准：`/config/app-config.json`）。

### 0.2 本文也覆盖的小程序发布流程
- `viewer`：3D viewer 小程序。
- `exhibition`：主题业务小程序。

> 小程序不通过 `docker-compose.prod.yml` 部署；其发布是独立的构建与微信后台上传流程。

---

## 1. 权威文件地图（先看这里）

部署时仅以以下文件为准：

- 编排与端口/挂载：`docker-compose.prod.yml`
- 升级脚本：`upgrade.sh`
- 后端生产环境变量：`server/.env.production`
- 后端镜像构建：`server/Dockerfile`
- 编辑器运行时配置模板：`editor/public/config/app-config.example.json`
- 上传端运行时配置模板：`uploader/public/config/app-config.example.json`
- Admin 运行时配置模板：`admin/admin-app-config.example.js`
- Admin API 基址读取：`admin/apps/web-antd/src/api/request.ts`
- Admin 生产配置读取：`admin/packages/effects/hooks/src/use-app-config.ts`

> 约束：本文示例宿主机根目录统一使用 `/www/web/v_touchmagic_cn/harmony`。

---

## 2. 前置检查（部署前必须通过）

1. 域名与 DNS 已就绪（A 记录指向生产服务器）。
2. 服务器具备 Docker Engine + Docker Compose v2。
3. 仓库代码可获取（`git clone` 或离线传包）。
4. 宿主机目录存在并可写：
   - `/www/web/v_touchmagic_cn/harmony/server/mongo-data`
   - `/www/web/v_touchmagic_cn/harmony/server/uploads`
   - `/www/web/v_touchmagic_cn/harmony/config`
5. 已准备生产配置文件：
   - `server/.env.production`
   - `editor-app-config.json`
   - `uploader-app-config.json`
   - `admin` 生产配置注入文件（见第 5.2 节）
6. **重要**：`admin` 服务构建链路需可用（`docker-compose.prod.yml` 中 `admin/Dockerfile` 必须存在且可构建）。

---

## 3. 服务器环境准备

### 3.1 安装 Docker 与 Compose（Ubuntu 示例）

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo apt-get update
sudo apt-get install -y docker-compose-plugin

docker version
docker compose version
```

### 3.2 创建目录

```bash
sudo mkdir -p /www/web/v_touchmagic_cn/harmony/server/mongo-data
sudo mkdir -p /www/web/v_touchmagic_cn/harmony/server/uploads
sudo mkdir -p /www/web/v_touchmagic_cn/harmony/config
```

### 3.3 初始化账号与基础数据（一次性）

```bash
cd /www/web/v_touchmagic_cn/harmony
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
```
## 4. 获取代码（生产机直接构建）

本指南仅支持在生产机直接从源码构建并部署（不再使用预构建镜像传输流程）。

在生产机上执行：

```bash
cd /www/web/v_touchmagic_cn/harmony
# 如果尚未克隆仓库：
git clone <your_repo_url> .

# 若仓库已存在并需更新到远端主分支：
git fetch --all
git reset --hard origin/main

# 从仓库根上下文构建并启动（包含 server/editor/admin/uploader 等服务）：
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

注意：所有镜像构建均应从仓库根上下文执行，确保 `schema/` 等 monorepo 依赖存在并可被构建系统访问。

---

## 5. 配置契约（新逻辑核心）

### 5.1 `server`（`.env.production`）

编辑文件：`server/.env.production`

关键变量：
- `NODE_ENV=production`
- `PORT=4000`
- `MONGODB_URI=mongodb://mongo:27017/harmony`
- `JWT_SECRET=<强随机值>`
- `ASSET_STORAGE_PATH=/app/uploads`
- `ASSET_PUBLIC_URL=https://v.touchmagic.cn/uploads`
- `EDITOR_PUBLIC_URL=https://editor.v.touchmagic.cn`
- `MULTIUSER_PORT=7645`
- `UPLOADER_USER_USERNAME` / `UPLOADER_USER_PASSWORD` / `UPLOADER_USER_DISPLAY_NAME`
- `MINIPROGRAM_TEST_USER_*`
- `OPENAI_*`（可选）

### 5.2 `admin`（生产基准：`window._VBEN_ADMIN_PRO_APP_CONF_`）

当前源码在生产环境通过 `window._VBEN_ADMIN_PRO_APP_CONF_` 读取 API 配置，而非 `__HARMONY_RUNTIME_CONFIG__`。

建议在前端静态目录注入 `_app.config.js`（或等价机制），至少包含：

仓库模板文件：`admin/admin-app-config.example.js`

可直接复制为服务器挂载文件：

```bash
cp admin/admin-app-config.example.js /www/web/v_touchmagic_cn/harmony/config/admin-app-config.js
```

```js
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_GLOB_API_URL: 'https://v.touchmagic.cn/api',
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: ''
};
Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_);
```

> 如你们后续统一成 `/config/app-config.json`，需先做源码改造后再更新本指南。

### 5.3 `editor`（运行时 `app-config.json`）

宿主机文件建议：`/www/web/v_touchmagic_cn/harmony/config/editor-app-config.json`

```json
{
  "serverApiBaseUrl": "https://v.touchmagic.cn",
  "serverApiPrefix": "/api",
  "assetPublicBaseUrl": "https://v.touchmagic.cn/uploads"
}
```

### 5.4 `uploader`（运行时 `app-config.json`）

宿主机文件建议：`/www/web/v_touchmagic_cn/harmony/config/uploader-app-config.json`

```json
{
  "serverApiBaseUrl": "https://v.touchmagic.cn",
  "serverApiPrefix": "/api"
}
```

### 5.5 小程序（`viewer` / `exhibition`）

编辑文件：
- `viewer/.env.production`
- `exhibition/.env.production`

关键变量：
- `VITE_MINI_API_BASE=https://v.touchmagic.cn/api/mini`

---

## 6. 启动与初始化

### 6.1 Compose 校验与启动

```bash
cd /www/web/v_touchmagic_cn/harmony
docker compose -f docker-compose.prod.yml config

docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### 6.2 首次初始化账号与基础数据

```bash
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
```

脚本将确保：
- 超级管理员
- uploader 专用账号
- 小程序测试账号

### 6.3 常用日志

```bash
docker compose -f docker-compose.prod.yml logs -f server
docker compose -f docker-compose.prod.yml logs -f mongo
docker compose -f docker-compose.prod.yml logs -f admin
docker compose -f docker-compose.prod.yml logs -f editor
docker compose -f docker-compose.prod.yml logs -f uploader
```

---

## 7. Nginx 反向代理与 HTTPS（示例）

以下仅示例核心映射，证书建议用 certbot 自动签发：

- `v.touchmagic.cn` → `127.0.0.1:4000`（`/api/`、`/uploads/`）
- `admin.v.touchmagic.cn` → `127.0.0.1:8087`
- `editor.v.touchmagic.cn` → `127.0.0.1:8088`
- `uploader.v.touchmagic.cn` → `127.0.0.1:8090`

`/uploads/` 与 `/api/` 必须分别反代到 server 并透传真实 IP 与协议头。

---

## 8. 发布验证清单（必须逐项通过）

### 8.1 容器与配置检查

```bash
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml ps
```

### 8.2 API 与静态资源

```bash
curl -I https://v.touchmagic.cn/api/auth/health
curl -I https://v.touchmagic.cn/uploads/<existing-file>
curl -I https://v.touchmagic.cn/uploads/<non-existing-file>
```

期望：
- health 返回 `200`
- 已存在资源返回 `200`
- 不存在资源返回 `404`

### 8.3 前端可用性

```bash
curl -I https://admin.v.touchmagic.cn/
curl -I https://editor.v.touchmagic.cn/
curl -I https://uploader.v.touchmagic.cn/
```

### 8.4 多人协同 WS

- 检查 `MULTIUSER_PORT`（默认 `7645`）监听。
- 按网络策略决定是否仅内网可达。

---

## 9. 升级流程

### 9.1 使用升级脚本（推荐）

```bash
cd /www/web/v_touchmagic_cn/harmony
./upgrade.sh all
# 或：./upgrade.sh server
# 或：./upgrade.sh admin editor
```

### 9.2 手工升级（按服务）

```bash
git pull --ff-only
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
docker compose -f docker-compose.prod.yml ps
```

全量升级：

```bash
git pull --ff-only
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### 9.3 仅修改前端运行时配置（无镜像重建）

- 修改宿主机 `config/*.json`（editor/uploader）或 `admin` 注入配置。
- 浏览器刷新后生效。

---

## 10. 回滚策略

### 10.1 代码回滚

```bash
git checkout <TAG_OR_COMMIT>
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### 10.2 镜像回滚

本部署策略以生产机直接构建为准，默认不使用预构建镜像传输流程。如在你的环境中仍使用镜像发布，请使用常规的 Docker 镜像回滚做法：将 `docker-compose.prod.yml` 指向目标镜像 tag，执行 `docker compose -f docker-compose.prod.yml up -d` 切回稳定版本，并确认服务与数据一致性。

### 10.3 数据回滚

必须同时管理两类数据：
- Mongo 数据目录：`/www/web/v_touchmagic_cn/harmony/server/mongo-data`
- 上传目录：`/www/web/v_touchmagic_cn/harmony/server/uploads`

回滚前要求：
- 有最近快照/备份。
- 已确认回滚窗口与业务停机策略。

---

## 11. `viewer` / `exhibition` 小程序完整发布流程

以下流程分别在 `viewer` 与 `exhibition` 目录执行。

### 11.1 安装依赖

```bash
pnpm install
```

### 11.2 生产构建（微信小程序）

```bash
pnpm run build:mp-weixin
```

说明：
- `prebuild:mp-weixin` 会先执行 `harmony-tools sync-scenery --mode subpackage-uni-modules`。
- 构建产物由 `uni build -p mp-weixin` 生成。

### 11.3 上传与发布

1. 用微信开发者工具打开构建产物目录。
2. 校验 `VITE_MINI_API_BASE` 已指向生产 `https://v.touchmagic.cn/api/mini`。
3. 完成预览、真机验证、上传版本。
4. 在微信公众平台提交审核并发布。

### 11.4 小程序冒烟用例

- 登录/鉴权流程。
- 列表拉取与详情加载。
- 场景资源加载。
- 关键交互（路径引导、热点、页面跳转等）。

---

## 12. 安全与运维基线

1. 强制替换默认口令与 `JWT_SECRET`。
2. 防火墙仅开放 `22/80/443`；`4000/8087/8088/8090` 优先仅本机监听并由反代暴露。
3. `MULTIUSER_PORT` 按需求限制来源网段。
4. 定期备份：`mongo-data` + `uploads`。
5. 日志与监控：至少接入容器日志轮转和基础可用性监控。
6. 禁止将真实密钥提交到仓库。

---

## 13. 常见问题（按当前结构）

| 问题 | 原因 | 处理 |
|---|---|---|
| `admin` 构建失败：`admin/Dockerfile` 不存在 | 构建链路未补齐 | 先补齐 `admin/Dockerfile` 或改 compose 到可用构建入口 |
| `ERR_MODULE_NOT_FOUND: Cannot find package '@/...'` | TS 路径别名未重写到产物 | 重新构建 `server`（Dockerfile 中应包含 `tsc-alias`/扩展修复流程） |
| 上传 403 | 路径穿越拦截 | 检查 URL 编码与路径合法性，不得包含 `..` |
| 健康检查失败 | 反代未转发 `/api/` | 校验 Nginx upstream 与 location 配置 |
| 小程序调用失败 | `VITE_MINI_API_BASE` 指向错误 | 修正生产 env 并重新构建上传 |

---

## 14. 一次性部署最小命令集（速查）

```bash
cd /www/web/v_touchmagic_cn/harmony

docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
docker compose -f docker-compose.prod.yml ps
```

如需自动化，可在 CI/CD 中串联以上步骤并增加失败回滚钩子。
