# Dependency Bootstrap

This repo now has a single bootstrap entry for restoring local package dependencies after branch switches:

```bash
node scripts/bootstrap.mjs viewer shared
node scripts/bootstrap.mjs viewer mp dev
node scripts/bootstrap.mjs viewer h5 build
node scripts/bootstrap.mjs editor
node scripts/bootstrap.mjs tour
node scripts/bootstrap.mjs exhibition
```

## Build-required packages

These packages produce `dist/` artifacts and should be rebuilt after branch switches:

- `utils`
- `physics-core`
- `physics-bridge`
- `schema`
- `tools`
- `physics-ammo` for `viewer` and `editor`
- `physics-cannon` for `viewer` and `editor`

## Source-only package

- `scenery` is kept as a source package and is consumed directly.

## What the bootstrap does

- reinstalls package manifests with frozen lockfiles
- removes stale `dist/` outputs for build-required packages
- rebuilds shared packages in a fixed order
- refreshes `viewer` sync artifacts and Vite caches

## Notes

- `tools/scripts/mini-program/prepare-shared.mjs` now hosts the shared bootstrap logic used by `tour` and `viewer`.
- `editor`, `tour`, `exhibition`, and `viewer` package scripts now reuse the same bootstrap entry instead of keeping their own ad-hoc dependency prep chains.
