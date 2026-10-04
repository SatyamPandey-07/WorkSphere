#!/bin/bash
# Build script for the WASM SIMD multi-channel audio filter pipeline (#1998).
#
# Prerequisites:
#   - clang with the wasm32 target + wasm-ld (LLVM >= 15). No Emscripten needed.
#
# Usage:
#   npm run build:wasm:audio-filter
#   # or: bash wasm/audio-filter/build.sh
#
# Produces two binaries; the loader picks one at runtime:
#   public/audio-filter-simd.wasm    (-msimd128, 4 channels per v128)
#   public/audio-filter-scalar.wasm  (no SIMD, for engines without wasm SIMD)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public"
SRC_FILE="$SCRIPT_DIR/audio_filter.c"
CLANG="${CLANG:-clang}"

mkdir -p "$OUTPUT_DIR"

COMMON_FLAGS=(
    --target=wasm32
    -O3
    -std=c11
    -nostdlib
    -ffreestanding
    -Wall
    -Wextra
    -Werror
    -Wl,--no-entry
    -Wl,--strip-all
)

build() {
    local out="$1"
    shift
    "$CLANG" "${COMMON_FLAGS[@]}" "$@" "$SRC_FILE" -o "$out"
    local size
    size=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")
    echo "Built $out ($size bytes)"
}

echo "Building WASM audio filter pipeline..."
build "$OUTPUT_DIR/audio-filter-simd.wasm" -msimd128
build "$OUTPUT_DIR/audio-filter-scalar.wasm"

echo "Building WASM polyphase sinc resampler..."
SRC_FILE="$SCRIPT_DIR/resampler.c"
build "$OUTPUT_DIR/audio-resampler-simd.wasm" -msimd128
build "$OUTPUT_DIR/audio-resampler-scalar.wasm"
