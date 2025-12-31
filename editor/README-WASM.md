# WASM integration for the Editor

This folder documents how to build and debug the Rust -> WebAssembly module used by the `editor` app.

Prerequisites
- Rust toolchain (stable)
- `wasm-pack` (https://rustwasm.github.io/wasm-pack/installer/)
- For production wasm size/opt: `binaryen` (for `wasm-opt`) recommended
- Optional: `watchexec` for automatic re-builds during development

Build commands (run from `editor`):

- Development build (includes debug info / easier WASM debugging):

```bash
npm run wasm:build:dev
```

- Production build (release + wasm-opt if available):

```bash
npm run wasm:build:prod
```

Notes on debugging in VSCode
- The provided launch config (`.vscode/launch.json`) has a "Launch Chrome (Editor)" target.
- Start the dev server first (or let the preLaunchTask run it):

```bash
npm run dev
```

- Then run the "Launch Chrome (Editor)" configuration to open Chrome attached to the debugger.
- In development builds the generated WASM will include debug-friendly information. Source maps for Rust -> WASM are an evolving area; this setup uses `wasm-pack --dev` and Vite source maps to make debugging easier.

If you want better DWARF-based source maps, consider generating DWARF and tooling like `wasm-sourcemap` and enabling the appropriate options in the Rust build pipeline. This README covers a pragmatic approach that works well for everyday development.
