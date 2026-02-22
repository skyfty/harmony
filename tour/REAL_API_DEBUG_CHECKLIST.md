# Tour 真实接口联调检查清单

本清单用于验证 tour 小程序已完全移除 mocks 并稳定走后端接口。

## 1) 启动顺序

1. 启动服务端：
   - `cd /home/sky/harmony/server && pnpm run dev`
2. 初始化账号与演示数据：
   - `cd /home/sky/harmony/server && pnpm run seed`
3. 启动 tour：
   - `cd /home/sky/harmony/tour && pnpm run dev:h5`（或 `pnpm run dev:mp-weixin`）

## 2) 环境变量确认（tour）

确保以下变量可用（`.env.development`）：

- `VITE_MINI_API_BASE=http://localhost:4000/api/mini`
- `VITE_MINI_AUTO_LOGIN=1`
- `VITE_MINI_TEST_USERNAME=test`
- `VITE_MINI_TEST_PASSWORD=test1234`

## 3) API 健康检查（curl）

先登录获取 token：

```bash
curl -s -X POST http://localhost:4000/api/mini-auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"test1234"}'
```

返回中取 `data.token`（或 `data.accessToken`）后执行：

```bash
TOKEN='<替换为上一步token>'

curl -s http://localhost:4000/api/mini/orders -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/mini-auth/profile -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/mini/achievements -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/mini/addresses -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/mini/feedback -H "Authorization: Bearer $TOKEN"
```

## 4) 页面手测路径

- 订单中心：`/pages/orders/index` -> 订单详情
- 个人中心：`/pages/profile/index` -> 编辑保存
- 地址管理：新增/编辑/删除
- 用户建议：提交建议 -> 返回列表可见
- 成就页：列表可加载且搜索可用

## 5) 稳定性验证点

- 断网后恢复：GET 请求应自动重试（指数退避）
- 重复快速进入同页：相同 GET 请求应去重
- token 失效：应出现鉴权失败提示，不应静默崩溃
- `@harmony/utils` 的 `httpRequest` 不可用场景：mini client 仍可通过内置 fallback 请求

## 6) 常见问题

- 若报 `httpRequest is not available from @harmony/utils`：
  - 已在 `tour/src/api/mini/client.ts` 提供 fallback；
  - 仍建议执行 `cd /home/sky/harmony/tour && pnpm run prepare:shared` 清理并重建共享依赖。
- 若 401：确认 seed 已创建测试账号，且 env 中用户名密码一致。
- 若请求失败：确认 `VITE_MINI_API_BASE` 指向 `/api/mini` 而非根域名。
