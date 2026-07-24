#!/bin/bash
# Emscripten build script for WASM SIMD Audio DSP Engine
#
# Prerequisites:
#   - Emscripten SDK installed and activated (source emsdk_env.sh)
#   - emcc/em++ available in PATH
#
# Usage:
#   cd wasm/audio-dsp
#   chmod +x build.sh
#   ./build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public"
SRC_FILE="$SCRIPT_DIR/audio_dsp.cpp"
OUTPUT_FILE="$OUTPUT_DIR/audio-dsp-processor.wasm"

mkdir -p "$OUTPUT_DIR"

echo "Building WASM SIMD Audio DSP Engine..."

# Compile with Emscripten using SIMD flags
em++ \
    -O3 \
    -msimd128 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_computeRMS","_computePeak","_rmsToDb","_processAudioFrame","_resetNoiseCalibration","_setNoiseGateSensitivity","_getNoiseProfile","_getLastSpectrum","_isSIMDSupported","_setSIMDEnabled","_malloc","_free","_resetHeap"]' \
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

# Get file size
WASM_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo "unknown")
echo "Build complete: $OUTPUT_FILE ($WASM_SIZE bytes)"
