# Harmony repo notes for AI coding agents

## Big picture (monorepo)
- `server/`: Koa + Mongo (Mongoose), serves `/api/*` + uploaded assets, and runs a multiuser WS service.
- `schema/`: shared TypeScript “scene/asset schema” package consumed by clients and server (`@harmony/schema`).
- `editor/`: Vue 3 + Vite + Vuetify + Three.js editor app.
- `admin/`: Vue 3 + Vite + Vuetify admin app.
- `uploader/`: Vue 3 + Vite + Vuetify uploader app.
- `viewer/`: uni-app 微信小程序 3D viewer（含可复用 `uni_modules/scenery` 分包模块）。
- `exhibition/`: uni-app 微信小程序主题业务端（不直接依赖 three/cannon，仅调用 scenery 分包）。

## Key workflows (use per-package scripts)
- Server dev: `cd server && npm run dev` (uses `server/.env.development`, runs with `tsx watch`).
- Server build/start: `cd server && npm run build && npm run start` (TS -> `dist/`, ESM).
- Seed accounts/data: `cd server && npm run seed` or `npm run seed:prod` (see `server/src/services/authService.ts`).
- Editor dev/build: `cd editor && npm run dev` / `npm run build`.
  - `editor` build runs `npm --prefix ../schema run build` first (don’t skip when changing `schema/`).
- Admin dev/build: `cd admin && npm run dev` / `npm run build`.
- Uploader dev/build: `cd uploader && npm run dev` / `npm run build`.
- Scene viewer: `cd viewer && npm run dev:mp-weixin`.
- Exhibition: `cd exhibition && npm run dev:mp-weixin`.

## Runtime config convention (important)
- Frontends load `/config/app-config.json` at startup and store it on `window.__HARMONY_RUNTIME_CONFIG__`.
  - Examples: `editor/public/config/app-config.example.json`, `admin/public/config/app-config.example.json`, `uploader/public/config/app-config.example.json`.
  - Production mounts these via Docker volumes (see `docker-compose.prod.yml` and `DEPLOYMENT.md`).

## Server structure & patterns
- Routers live in `server/src/routes/*` and typically use `new Router({ prefix: '/api/...' })` (example: `server/src/routes/auth.ts`).
- Controllers in `server/src/controllers/*`; business logic in `server/src/services/*`; DB models in `server/src/models/*`.
- Error style: controllers commonly use `ctx.throw(status, message)`; global formatting is in `server/src/middleware/errorHandler.ts`.
- Upload serving: `server/src/index.ts` serves uploaded files from `ASSET_STORAGE_PATH` under the URL prefix derived from `ASSET_PUBLIC_URL`.
- Multiuser WS: configured by `MULTIUSER_PORT` (default 7645) and started in `server/src/index.ts` via `MultiuserService`.

## TypeScript/ESM + import conventions
- Server is ESM (`"type": "module"`) and uses TS path alias `@/*` via `server/tsconfig.json`.
- Build outputs run `harmony-tools fix-esm-extensions --root dist` (server + schema) — keep source imports idiomatic ESM; avoid mixing CommonJS unless you’re following existing compat code (see `server/src/utils/cjsCompat.ts`).

## Vite aliases (editor)
- `editor/vite.config.ts` defines `@` -> `editor/src` and `@schema` -> `schema/` source.
  - When changing shared schema APIs, prefer updating `schema/` exports (see `schema/index.ts`) and rebuilding.
