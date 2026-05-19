# Dependency Bootstrap

This repo now has a single bootstrap entry for restoring local package dependencies after branch switches:

```bash
pnpm --dir viewer run bootstrap:shared
pnpm --dir viewer run bootstrap:mp-weixin:dev
pnpm --dir viewer run bootstrap:h5:build
pnpm --dir editor run bootstrap
pnpm --dir tour run bootstrap:shared
pnpm --dir exhibition run bootstrap
```

## Build-required packages

These packages produce `dist/` artifacts and should be rebuilt after branch switches:

- `utils`
- `physics-core`
- `physics-bridge`
- `schema`
- `tools`
- `physics-ammo` for `viewer`, `tour`, and `editor`
- `physics-cannon` for `viewer`, `tour`, and `editor`

## Source-only package

- `scenery` is kept as a source package and is consumed directly.

## What the bootstrap does

- reinstalls package manifests with frozen lockfiles
- removes stale `dist/` outputs for build-required packages
- rebuilds shared packages in a fixed order
- refreshes `viewer` / `tour` sync artifacts and Vite caches

## Notes

- `tools/scripts/bootstrap/application.mjs` now hosts the application-level bootstrap flow used by `editor`, `tour`, `exhibition`, and `viewer`.
- `tools/scripts/bootstrap/shared-dependencies.mjs` now hosts the shared dependency rebuild flow used by the application bootstrap and by `viewer` / `tour` shared preparation.
- `tools/scripts/mini-program/prepare-shared.mjs` now hosts the shared bootstrap logic used by `tour` and `viewer`.
- `editor`, `tour`, `exhibition`, and `viewer` package scripts now reuse the same bootstrap entry instead of keeping their own ad-hoc dependency prep chains.
- `viewer` and `tour` now also sync `physics-*`, `schema`, and `scenery` mirror directories during bootstrap so H5 and WeChat mini program layouts stay aligned.
