# editor/wasm

This folder contains a small Rust crate that builds to WebAssembly using `wasm-pack`.

Quick commands (run from `editor/`):

Development build (with debug info / easier debugging):

```bash
npm run wasm:build:dev
```

Production build (release, with optional `wasm-opt` shrinking if available):

```bash
npm run wasm:build:prod
```

Loading from the app
- Use `import { loadWasm } from './src/wasm/loader'` then `const pkg = await loadWasm()`.

Debugging in VSCode / Browser
- The project produces source maps when running the dev build; attach the Chrome debugger
  to `http://localhost:8088` (the dev server) and set breakpoints in Rust sources if your
  toolchain produced proper source maps (see `.vscode/launch.json`).

Notes
- Requires `wasm-pack` to be available via `npx wasm-pack` (it will install if necessary).
- For best debugging experience, install `wasm-opt` (from Binaryen) for production optimization.
