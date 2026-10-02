#!/usr/bin/env bash
# Compile Circom → WASM and build a Groth16 zkey for premium membership proofs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUIT_DIR/build"
OUT_DIR="$ROOT/public/zkp"
PTAU="$BUILD_DIR/pot12_final.ptau"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

# The circuit includes circomlib's Poseidon template, so circomlib must be installed.
if [[ ! -f "$ROOT/node_modules/circomlib/circuits/poseidon.circom" ]]; then
  echo "error: circomlib is not installed. Run: npm install --save-dev circomlib" >&2
  exit 1
fi

echo ">> compiling circuit"
npx circom2 "$CIRCUIT_DIR/premium_membership.circom" \
  --r1cs --wasm --sym \
  -l "$ROOT/node_modules" \
  -o "$BUILD_DIR"

if [[ ! -f "$PTAU" ]]; then
  echo ">> powers of tau (small ceremony for this toy circuit)"
  npx snarkjs powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau" -v

  CONTRIBUTION_ENTROPY="$(openssl rand -hex 32)"
  npx snarkjs powersoftau contribute \
    "$BUILD_DIR/pot12_0000.ptau" \
    "$BUILD_DIR/pot12_0001.ptau" \
    --name="worksphere" \
    -e="$CONTRIBUTION_ENTROPY"

  npx snarkjs powersoftau prepare phase2 \
    "$BUILD_DIR/pot12_0001.ptau" \
    "$PTAU"
fi

echo ">> groth16 setup"
npx snarkjs groth16 setup \
  "$BUILD_DIR/premium_membership.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/premium_membership_0000.zkey"

ZKEY_ENTROPY="$(openssl rand -hex 32)"
npx snarkjs zkey contribute \
  "$BUILD_DIR/premium_membership_0000.zkey" \
  "$BUILD_DIR/premium_membership_final.zkey" \
  --name="worksphere" \
  -e="$ZKEY_ENTROPY"

npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/premium_membership_final.zkey" \
  "$OUT_DIR/verification_key.json"

cp "$BUILD_DIR/premium_membership_js/premium_membership.wasm" \
  "$OUT_DIR/premium_membership.wasm"
cp "$BUILD_DIR/premium_membership_final.zkey" \
  "$OUT_DIR/premium_membership.zkey"

# Record which circuit these artifacts were built from. A Jest test
# (src/__tests__/lib/zkpArtifactFreshness.test.ts) compares this manifest with
# circuits/premium_membership.circom so a circuit edit without a rebuild fails CI
# instead of silently breaking every proof.
echo ">> writing artifact manifest"
CIRCOM_SRC="$CIRCUIT_DIR/premium_membership.circom" \
CIRCOMLIB_PKG="$ROOT/node_modules/circomlib/package.json" \
MANIFEST_OUT="$OUT_DIR/artifacts.manifest.json" \
node -e '
const fs = require("fs");
const crypto = require("crypto");
// Normalize line endings so CRLF and LF checkouts hash identically.
const src = fs.readFileSync(process.env.CIRCOM_SRC, "utf8").replace(/\r\n/g, "\n");
const manifest = {
  circuit: "premium_membership.circom",
  circuitSha256: crypto.createHash("sha256").update(src).digest("hex"),
  commitmentScheme: "poseidon-bn254",
  circomlibVersion: JSON.parse(fs.readFileSync(process.env.CIRCOMLIB_PKG, "utf8")).version,
};
fs.writeFileSync(process.env.MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
'

# Keep a copy of the WASM witness helper next to the circuit build for local proofs.
echo ">> done — artifacts in public/zkp/ (commit them together with artifacts.manifest.json)"
