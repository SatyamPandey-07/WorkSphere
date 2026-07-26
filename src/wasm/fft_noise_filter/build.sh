#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public"
SRC_FILE="$SCRIPT_DIR/fft_noise_filter.cpp"
OUTPUT_FILE="$OUTPUT_DIR/fft-noise-filter.wasm"

mkdir -p "$OUTPUT_DIR"

echo "Building WASM FFT Noise Filter Engine (#1123)..."

em++ \
    -O3 \
    -msimd128 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_fftnfProcessFrame","_fftnfReset","_fftnfSetSensitivity","_fftnfGetNoiseProfile","_fftnfGetSpectrum","_fftnfComputeMagnitude","_fftnfRmsToDb","_fftnfIsSIMDSupported","_fftnfSetSIMDEnabled","_fftnfMalloc","_fftnfFree","_fftnfResetHeap"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=1048576 \
    -s MAXIMUM_MEMORY=4194304 \
    -s MODULARIZE=0 \
    -s SINGLE_FILE=0 \
    -s ENVIRONMENT='web' \
    -s FILESYSTEM=0 \
    -s NO_DYNAMIC_EXECUTION=1 \
    -s MALLOC=emmalloc \
    --no-entry \
    "$SRC_FILE" \
    -o "$OUTPUT_FILE"

WASM_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo "unknown")
echo "Build complete: $OUTPUT_FILE ($WASM_SIZE bytes)"
