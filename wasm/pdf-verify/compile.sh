#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENGINE_DIR="$SCRIPT_DIR/engine"
OUT_DIR="$PROJECT_ROOT/public"

echo "=== Compiling PDF Signature Verification WASM Engine ==="
echo "Engine source: $ENGINE_DIR"
echo "Output dir:    $OUT_DIR"

if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc (Emscripten) not found. Install via: git clone https://github.com/emscripten-core/emsdk.git && cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
  exit 1
fi

emcc "$ENGINE_DIR/pdf_verify.cpp" \
  -o "$OUT_DIR/pdf-verify.js" \
  -lembind \
  -O2 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s SINGLE_FILE=0 \
  -s WASM=1 \
  -s FILESYSTEM=0 \
  -s ASSERTIONS=0 \
  -s ENVIRONMENT='web,worker' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -lssl \
  -lcrypto \
  --closure 1

echo "=== Build complete ==="
ls -lh "$OUT_DIR/pdf-verify.js" "$OUT_DIR/pdf-verify.wasm"
