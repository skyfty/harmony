# Harmony 生产部署指南（2026 新逻辑）

# Harmony — 生产部署速查

精简版：保留可执行步骤与关键文件路径，方便快速上手与故障排查。

## 适用服务
- `server` (Koa API + 上传 + multiuser WS)、`mongo`、`admin`、`editor`、`uploader`（由 `docker-compose.prod.yml` 管理）

## 必备前提
- Docker + Docker Compose v2
- 在生产机可从仓库根构建（monorepo 上下文）
- 宿主机目录（示例）: `/www/web/v_touchmagic_cn/harmony/server/mongo-data`, `/www/web/v_touchmagic_cn/harmony/server/uploads`, `/www/web/v_touchmagic_cn/harmony/config`
- 关键运行时文件（普通文件）: `server/.env.production`, `config/editor-app-config.json`, `config/uploader-app-config.json`, `config/admin-app-config.js`

## 权威文件（优先参照）
- `docker-compose.prod.yml`, `server/.env.production`, `server/Dockerfile`, `admin/admin-app-config.prod.js`, `config/*`

## 最小部署流程
在仓库根运行：

```bash
./bootstrap-prod-config.sh
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
docker compose -f docker-compose.prod.yml ps
```

说明：`bootstrap-prod-config.sh` 会创建缺失挂载文件和目录。

## 运行时要点
- `server/.env.production`：设置 `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `ASSET_STORAGE_PATH`, `ASSET_PUBLIC_URL`, `MULTIUSER_PORT`
	- 示例：`ASSET_PUBLIC_URL=http://v.touchmagic.cn/uploads`
- `editor`/`uploader`：挂载 `config/*.json`，修改后无需重建镜像
	- `editor` 生产示例：`serverApiBaseUrl=http://editor.v.touchmagic.cn`
	- `uploader` 生产示例：`serverApiBaseUrl=http://uploader.v.touchmagic.cn`
- `admin`：通过注入 `admin-app-config.js`（`window._VBEN_ADMIN_PRO_APP_CONF_`）配置 API 基址
	- 生产示例：`VITE_GLOB_API_URL=http://v.touchmagic.cn/api`

## 检查点（快速验证）
- API 健康： `curl -I http://v.touchmagic.cn/api/auth/health` → 200
- 静态资源： `curl -I http://v.touchmagic.cn/uploads/<file>` → 200/404
- 前端首页： `curl -I http://v.touchmagic.cn/`, `http://editor.v.touchmagic.cn/`, `http://uploader.v.touchmagic.cn/`

## 查看 Docker 日志
生产环境排查常用命令：

- 查看 compose 服务的实时日志（跟随输出）：

```bash
docker compose -f docker-compose.prod.yml logs -f <service>
# 例如查看 server 服务日志
docker compose -f docker-compose.prod.yml logs -f server
```

- 限制输出行数并显示时间戳：

```bash
docker compose -f docker-compose.prod.yml logs --timestamps --tail 200 -f server
```

- 若需查看单个容器（非 compose 命令）、或在容器名已知时：

```bash
docker logs -f --since 1h <container_name_or_id>
```

- 结合 `grep` 或 `--since` 快速定位错误，例如只看 error：

```bash
docker compose -f docker-compose.prod.yml logs server --since 10m | grep -i error
```

说明：在生产环境中，`docker compose` 命令会自动使用 `docker-compose.prod.yml` 指定的服务定义；若你通过 systemd 或其他方式运行容器，请使用对应的容器名称或日志收集工具（如 `journald` / ELK / Prometheus + Loki）。

## 升级与回滚（简要）
- 推荐升级： `./upgrade.sh all` 或 `./upgrade.sh server`
- 手工升级：

```bash
git pull --ff-only
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```

- 回滚：`git checkout <tag|commit>` → 重建并重启容器；数据回滚需恢复 `mongo-data` 与 `uploads` 备份

## 小程序构建（若需要）

```bash
cd viewer || cd exhibition
pnpm install
pnpm run build:mp-weixin
```

确认 `VITE_MINI_API_BASE` 指向生产 API。
同时确认 `VITE_MINI_DOWNLOAD_CDN_BASE`：
- 生产：`https://cdn.touchmagic.cn`
- 开发：`http://localhost:4000`

## 运营与安全要点
- 定期备份 `mongo-data` 与 `uploads`
- secrets（`JWT_SECRET` 等）不得提交仓库
- 使用 Nginx/反代 + HTTPS 暴露对外服务；限制直接外网端口访问

需要我把某一节（例如 Nginx 配置、`.env.production` 示例或回滚细节）恢复为原始详细版吗？
## 14. 一次性部署最小命令集（速查）

```bash
cd /www/web/v_touchmagic_cn/harmony

./bootstrap-prod-config.sh
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
docker compose -f docker-compose.prod.yml ps
```

如需自动化，可在 CI/CD 中串联以上步骤并增加失败回滚钩子。
