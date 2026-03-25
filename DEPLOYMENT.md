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
docker compose -f docker-compose.prod.yml config

docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile ops run --rm server-seed
docker compose -f docker-compose.prod.yml ps

docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```

说明：`bootstrap-prod-config.sh` 会创建缺失挂载文件和目录。

## 运行时要点
- `server/.env.production`：设置 `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `ASSET_STORAGE_PATH`, `ASSET_PUBLIC_URL`, `MULTIUSER_PORT`
	- 示例：`ASSET_PUBLIC_URL=https://v.touchmagic.cn/uploads`

### MongoDB 鉴权（生产强化）

`docker-compose.prod.yml` 已启用 MongoDB 鉴权与应用账号初始化，部署前需在当前目录 `.env`（或 CI/CD 环境变量）设置：

- `MONGO_ROOT_USERNAME`
- `MONGO_ROOT_PASSWORD`
- `MONGO_APP_DATABASE`（可选，默认 `harmony`）
- `MONGO_APP_USERNAME`
- `MONGO_APP_PASSWORD`

建议 `server/.env.production` 中 `MONGODB_URI` 使用业务账号而非 root，例如：

```env
MONGODB_URI=mongodb://<MONGO_APP_USERNAME>:<MONGO_APP_PASSWORD>@mongo:27017/<MONGO_APP_DATABASE>?authSource=<MONGO_APP_DATABASE>
```

说明：Mongo 首次初始化时会执行 `server/mongo-init/01-create-app-user.js`，为业务库创建 `readWrite` 最小权限账号。

网络隔离：`mongo` 仅加入 `harmony-backend`（`internal: true`）内部网络，默认不对宿主机开放端口；仅 `server` / `server-seed` 可通过容器网络访问 Mongo。
对外暴露策略：`server/admin/editor` 端口仅绑定 `127.0.0.1`，不可被外网直接访问；请统一通过 Nginx/反向代理暴露域名入口。
- `editor`/`uploader`：挂载 `config/*.json`，修改后无需重建镜像
	- `editor` 生产示例：`serverApiBaseUrl=http://editor.v.touchmagic.cn`
	- `uploader` 生产示例：`serverApiBaseUrl=http://uploader.v.touchmagic.cn`
- `admin`：通过注入 `admin-app-config.js`（`window._VBEN_ADMIN_PRO_APP_CONF_`）配置 API 基址
	- 生产示例：`VITE_GLOB_API_URL=http://v.touchmagic.cn/api`

## 检查点（快速验证）
- API 健康： `curl -I https://v.touchmagic.cn/api/auth/health` → 200
- 静态资源： `curl -I https://v.touchmagic.cn/uploads/<file>` → 200/404
- 前端首页： `curl -I https://v.touchmagic.cn/`, `http://editor.v.touchmagic.cn/`, `http://uploader.v.touchmagic.cn/`

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

## 微信支付配置（2026-02）

在 `server/.env.production` 至少配置以下变量：

- `WECHAT_PAY_ENABLED=true`
- `WECHAT_PAY_APP_ID`：小程序 AppID
- `WECHAT_PAY_MCH_ID`：微信商户号
- `WECHAT_PAY_SERIAL_NO`：商户证书序列号
- `WECHAT_PAY_PRIVATE_KEY`：商户 API 证书私钥（PEM 内容，换行使用 `\n`）
- `WECHAT_PAY_API_V3_KEY`：APIv3 Key（32位）
- `WECHAT_PAY_NOTIFY_URL`：例如 `https://v.touchmagic.cn/wechat/pay/notify`
- `WECHAT_PAY_PLATFORM_PUBLIC_KEY`：微信支付平台公钥（PEM）

可选项：

- `WECHAT_PAY_BASE_URL`（默认 `https://api.mch.weixin.qq.com`）
- `WECHAT_PAY_CALLBACK_SKIP_VERIFY_IN_DEV`（仅开发环境联调时可 `true`，生产必须 `false`）

### 回调接口

- 地址：`POST /wechat/pay/notify`
- 用途：接收微信支付通知，更新订单 `orderStatus/paymentStatus`，并发放商品权益
- 接口无需登录态，依赖微信签名校验保障安全

### 本地联调（无需真实微信回调）

1. 开发环境设置：
	- `WECHAT_PAY_ENABLED=true`
	- `WECHAT_PAY_API_V3_KEY` 填 32 位字符串
	- 可临时开启 `WECHAT_PAY_CALLBACK_SKIP_VERIFY_IN_DEV=true`
2. 启动服务：`cd server && pnpm run dev`
3. 先通过 mini 接口创建订单并发起支付，拿到 `orderNumber`
4. 发送模拟通知：

```bash
cd server
pnpm run mock:wechat-notify -- <orderNumber> success
# 或模拟失败
pnpm run mock:wechat-notify -- <orderNumber> fail
```

5. 验证订单状态：
	- `paymentStatus` 变为 `succeeded`/`failed`
	- 成功时 `orderStatus=paid` 且写入支付结果

需要我把某一节（例如 Nginx 配置、`.env.production` 示例或回滚细节）恢复为原始详细版吗？

## 微信小程序授权登录配置（2026-02）

在 `server/.env.production` 配置以下变量后，`/api/mini-auth/wechat-login` 将支持前端传 `code` 自动登录/注册：

- `WECHAT_MINI_APP_ID`：小程序 AppID
- `WECHAT_MINI_APP_SECRET`：小程序 AppSecret
- `WECHAT_API_BASE_URL`：默认 `https://api.weixin.qq.com`

多小程序共享同一套 server 时，推荐额外配置：

- `WECHAT_MINI_DEFAULT_APP_ID`：默认小程序标识（前端未传 `miniAppId` 时兜底）
- `WECHAT_MINI_APPS_JSON`：多小程序登录配置，JSON 对象，key 为 `miniAppId`

示例：

```json
{
	"wx_app_a": { "appId": "wx_app_a", "appSecret": "secret_a" },
	"wx_app_b": { "appId": "wx_app_b", "appSecret": "secret_b" }
}
```

说明：

- 服务端会调用 `sns/jscode2session` 交换 `openid/unionid`
- 用户不存在时自动注册并签发 mini token（按 `miniAppId + openid` 维度隔离）
- 同一 `openid` 会复用已有账号；`unionid`（如返回）会写入用户档案

## 微信支付多小程序共享配置（2026-02）

当多个小程序共用同一后端支付服务时，可配置：

- `WECHAT_PAY_DEFAULT_APP_ID`：默认支付小程序标识
- `WECHAT_PAY_APPS_JSON`：多小程序支付配置，JSON 对象，key 为 `miniAppId`

示例：

```json
{
	"wx_app_a": {
		"enabled": true,
		"appId": "wx_app_a",
		"mchId": "mch_a",
		"serialNo": "serial_a",
		"privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
		"apiV3Key": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		"notifyUrl": "https://v.touchmagic.cn/wechat/pay/notify/wx_app_a",
		"baseUrl": "https://api.mch.weixin.qq.com",
		"platformPublicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
		"callbackSkipVerifyInDev": false,
		"mockPlatformPrivateKey": ""
	}
}
```

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
