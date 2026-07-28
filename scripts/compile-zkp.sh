#!/usr/bin/env bash
# Compile Circom → WASM and build a groth16 zkey for premium membership proofs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUIT_DIR/build"
OUT_DIR="$ROOT/public/zkp"
PTAU="$BUILD_DIR/pot12_final.ptau"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

echo ">> compiling circuit"
npx circom2 "$CIRCUIT_DIR/premium_membership.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR"

if [[ ! -f "$PTAU" ]]; then
  echo ">> powers of tau (small ceremony for this toy circuit)"
  npx snarkjs powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau" -v
  CONTRIBUTION_ENTROPY=$(openssl rand -hex 32)
  npx snarkjs powersoftau contribute "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" \
    --name="worksphere" -e="$CONTRIBUTION_ENTROPY"
  npx snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot12_0001.ptau" "$PTAU"
fi

echo ">> groth16 setup"
npx snarkjs groth16 setup \
  "$BUILD_DIR/premium_membership.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/premium_membership_0000.zkey"

ZKEY_ENTROPY=$(openssl rand -hex 32)
npx snarkjs zkey contribute \
  "$BUILD_DIR/premium_membership_0000.zkey" \
  "$BUILD_DIR/premium_membership_final.zkey" \
  --name="worksphere" -e="$ZKEY_ENTROPY"

npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/premium_membership_final.zkey" \
  "$OUT_DIR/verification_key.json"

cp "$BUILD_DIR/premium_membership_js/premium_membership.wasm" "$OUT_DIR/premium_membership.wasm"
cp "$BUILD_DIR/premium_membership_final.zkey" "$OUT_DIR/premium_membership.zkey"

# Keep a copy of the wasm witness helper next to the circuit build for local proves.
echo ">> done — artifacts in public/zkp/"
