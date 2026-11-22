#!/bin/bash
# Build script for the IoT power anomaly detector C WASM module (#9519).
#
# Prerequisites:
#   - Emscripten (emcc >= 3.1) or clang with wasm32 target
#
# Usage:
#   npm run build:wasm:power-anomaly
#   # or: bash src/wasm/sensors/build.sh
#
# Produces:
#   public/wasm/power_anomaly.wasm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public/wasm"
SRC_FILE="$SCRIPT_DIR/power_anomaly.c"

mkdir -p "$OUTPUT_DIR"

if command -v emcc >/dev/null 2>&1; then
    echo "Compiling power_anomaly.c with emcc..."
    emcc -O3 -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS="['_init_stats', '_analyze_power_draw', '_get_moving_average', '_get_sample_count']" \
        --no-entry "$SRC_FILE" -o "$OUTPUT_DIR/power_anomaly.wasm"
    echo "Successfully built $OUTPUT_DIR/power_anomaly.wasm"
elif command -v clang >/dev/null 2>&1; then
    echo "Compiling power_anomaly.c with clang..."
    clang --target=wasm32 -O3 -std=c11 -nostdlib -ffreestanding -Wl,--no-entry -Wl,--export-all "$SRC_FILE" -o "$OUTPUT_DIR/power_anomaly.wasm"
    echo "Successfully built $OUTPUT_DIR/power_anomaly.wasm"
else
    echo "Error: Neither emcc nor clang (wasm32) found in PATH. Please install Emscripten or LLVM with wasm32 target." >&2
    exit 1
fi
