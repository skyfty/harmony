#!/usr/bin/env bash
set -euo pipefail

# Build wasm for CI with debuginfo and produce artifacts (release wasm + separate debug file)
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "Installing wasm-pack if missing..."
if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack || true
fi

echo "Adding target wasm32-unknown-unknown"
rustup target add wasm32-unknown-unknown || true

# Ensure output dir exists
mkdir -p wasm/pkg

echo "Building wasm (release) with debuginfo..."
# Keep debug info for DWARF; wasm-bindgen will emit wasm
export RUSTFLAGS="-C debuginfo=2"
wasm-pack build wasm --target web --out-dir pkg --release

WASM_FILE=$(ls wasm/pkg/*.wasm 2>/dev/null | head -n1 || true)
if [ -z "$WASM_FILE" ]; then
  echo "No wasm file produced"
  exit 1
fi

echo "WASM produced: $WASM_FILE"

# Optionally run wasm-opt if available to optimize size
if command -v wasm-opt >/dev/null 2>&1; then
  echo "Running wasm-opt -Oz"
  wasm-opt -Oz "$WASM_FILE" -o "$WASM_FILE.optimized"
  mv "$WASM_FILE.optimized" "$WASM_FILE"
fi

# Copy debug info (DWARF) out for later retrieval: create a .debug.wasm copy
cp "$WASM_FILE" "${WASM_FILE}.debug"

echo "WASM build complete. Artifacts in wasm/pkg/"

# DWARF->source-map conversion is handled by CI after `npm ci` (so wasm-sourcemap is installed).
