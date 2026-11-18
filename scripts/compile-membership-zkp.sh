#!/usr/bin/env bash
# Compile circuits/membership_verifier.circom → WASM and build a Groth16 zkey
# for anonymous paid-membership (venue access) proofs.
#
# The circuit is MembershipVerifier(16) and needs a 2^14 powers-of-tau
# ceremony: it uses ~8.9k wires, so the 2^13 pot used by the toy premium
# circuit is too small (`8837*2 > 2**13`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUIT_DIR/build"
OUT_DIR="$ROOT/public/zkp"
CIRCUIT="membership_verifier"
PTAU="$BUILD_DIR/pot14_final.ptau"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

# The circuit includes circomlib's Poseidon template, so circomlib must be installed.
if [[ ! -f "$ROOT/node_modules/circomlib/circuits/poseidon.circom" ]]; then
  echo "error: circomlib is not installed. Run: npm install --save-dev circomlib" >&2
  exit 1
fi

echo ">> compiling circuit"
npx circom2 "$CIRCUIT_DIR/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  -l "$ROOT/node_modules" \
  -o "$BUILD_DIR"

if [[ ! -f "$PTAU" ]]; then
  echo ">> powers of tau (bn128, 2^14)"
  npx snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0000.ptau" -v

  CONTRIBUTION_ENTROPY="$(openssl rand -hex 32)"
  npx snarkjs powersoftau contribute \
    "$BUILD_DIR/pot14_0000.ptau" \
    "$BUILD_DIR/pot14_0001.ptau" \
    --name="worksphere" \
    -e="$CONTRIBUTION_ENTROPY"

  npx snarkjs powersoftau prepare phase2 \
    "$BUILD_DIR/pot14_0001.ptau" \
    "$PTAU"
fi

echo ">> groth16 setup"
npx snarkjs groth16 setup \
  "$BUILD_DIR/$CIRCUIT.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey"

ZKEY_ENTROPY="$(openssl rand -hex 32)"
npx snarkjs zkey contribute \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey" \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  --name="worksphere" \
  -e="$ZKEY_ENTROPY"

npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  "$OUT_DIR/${CIRCUIT}_vkey.json"

cp "$BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm" "$OUT_DIR/$CIRCUIT.wasm"
cp "$BUILD_DIR/${CIRCUIT}_final.zkey" "$OUT_DIR/$CIRCUIT.zkey"

# Record which circuit these artifacts were built from, mirroring the premium
# manifest so a circuit edit without a rebuild is visible in review.
echo ">> writing artifact manifest"
CIRCOM_SRC="$CIRCUIT_DIR/$CIRCUIT.circom" \
CIRCOMLIB_PKG="$ROOT/node_modules/circomlib/package.json" \
MANIFEST_OUT="$OUT_DIR/$CIRCUIT.manifest.json" \
node -e '
const fs = require("fs");
const crypto = require("crypto");
// Normalize line endings so CRLF and LF checkouts hash identically.
const src = fs.readFileSync(process.env.CIRCOM_SRC, "utf8").replace(/\r\n/g, "\n");
const manifest = {
  circuit: "membership_verifier.circom",
  circuitSha256: crypto.createHash("sha256").update(src).digest("hex"),
  commitmentScheme: "poseidon-bn254-merkle16",
  circomlibVersion: JSON.parse(fs.readFileSync(process.env.CIRCOMLIB_PKG, "utf8")).version,
};
fs.writeFileSync(process.env.MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
'

echo ">> done — artifacts in public/zkp/$CIRCUIT.{wasm,zkey}, ${CIRCUIT}_vkey.json"
