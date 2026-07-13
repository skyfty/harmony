# Mini App Scaffold

This repo now includes a generator for new uni-app mini apps that share the same platform adapter layer as `tour` and `viewer`.

## Generate

```bash
node scripts/create-mini-app.mjs --name <app-name> --app-key <app-key> --app-type <tour|viewer> --target ./apps/<app-name>
```

## What gets generated

- `src/App.vue`
- `src/main.ts`
- `src/platform/runtime.ts`
- `src/platform/adapter.ts`
- `src/pages/index/index.vue`
- `src/pages.json`
- `src/manifest.json`
- `vite.config.ts`
- `tsconfig.*.json`
- `package.json`

## Conventions

- Use `VITE_MINI_APP_KEY` as the business key for runtime config loading.
- Keep platform-specific logic inside adapters only.
- Put platform config in admin, not in app code.
- Inject platform appid and secrets at build time or from CI secrets.

## Notes

- The scaffold is intentionally minimal.
- Add your own business pages and modules on top of the generated shell.
