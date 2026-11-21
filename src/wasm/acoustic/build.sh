#!/bin/bash
# Build the Rust acoustic sound classifier for the browser (#7277).
#
# Prerequisites: Rust >= 1.54 with the wasm32 target
#   rustup target add wasm32-unknown-unknown
#
# Usage:
#   npm run build:wasm:sound-classifier
#   # or: bash src/wasm/acoustic/build.sh
#
# Produces two binaries; WasmSoundClassifier.ts picks one at runtime:
#   public/sound_classifier.wasm         (+simd128, 128-bit f32x4 kernels)
#   public/sound_classifier_scalar.wasm  (no SIMD, for engines without wasm SIMD)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public"
ARTIFACT="$SCRIPT_DIR/target/wasm32-unknown-unknown/release/sound_classifier.wasm"

mkdir -p "$OUTPUT_DIR"
cd "$SCRIPT_DIR"

# SIMD build: .cargo/config.toml already enables +simd128.
cargo build --release --target wasm32-unknown-unknown
cp "$ARTIFACT" "$OUTPUT_DIR/sound_classifier.wasm"

# Scalar build: an explicit (empty) RUSTFLAGS overrides the config file.
RUSTFLAGS="" cargo build --release --target wasm32-unknown-unknown
cp "$ARTIFACT" "$OUTPUT_DIR/sound_classifier_scalar.wasm"

ls -l "$OUTPUT_DIR"/sound_classifier*.wasm
