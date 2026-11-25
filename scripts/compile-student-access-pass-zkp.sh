#!/usr/bin/env bash
# Compile student_access_pass.circom and create its matching Groth16 artifacts.
# The circuit exposes exactly three public signals: root, epoch, nullifierHash.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUIT_DIR/build"
OUT_DIR="$ROOT/public/zkp"
CIRCUIT="student_access_pass"
PTAU="$BUILD_DIR/pot14_student_access_pass_final.ptau"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

if [[ ! -f "$ROOT/node_modules/circomlib/circuits/poseidon.circom" ]]; then
  echo "error: circomlib is not installed. Run: npm install --save-dev circomlib" >&2
  exit 1
fi

echo ">> compiling $CIRCUIT"
npx circom2 "$CIRCUIT_DIR/$CIRCUIT.circom" \
  --r1cs --wasm --sym \
  -l "$ROOT/node_modules" \
  -o "$BUILD_DIR"

if [[ ! -f "$PTAU" ]]; then
  echo ">> powers of tau (bn128, 2^14)"
  npx snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_student_access_pass_0000.ptau" -v

  CONTRIBUTION_ENTROPY="$(openssl rand -hex 32)"
  npx snarkjs powersoftau contribute \
    "$BUILD_DIR/pot14_student_access_pass_0000.ptau" \
    "$BUILD_DIR/pot14_student_access_pass_0001.ptau" \
    --name="worksphere-student-access-pass" \
    -e="$CONTRIBUTION_ENTROPY"

  npx snarkjs powersoftau prepare phase2 \
    "$BUILD_DIR/pot14_student_access_pass_0001.ptau" \
    "$PTAU"
fi

echo ">> Groth16 setup"
npx snarkjs groth16 setup \
  "$BUILD_DIR/$CIRCUIT.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey"

ZKEY_ENTROPY="$(openssl rand -hex 32)"
npx snarkjs zkey contribute \
  "$BUILD_DIR/${CIRCUIT}_0000.zkey" \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  --name="worksphere-student-access-pass" \
  -e="$ZKEY_ENTROPY"

npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/${CIRCUIT}_final.zkey" \
  "$OUT_DIR/${CIRCUIT}_vkey.json"

cp "$BUILD_DIR/${CIRCUIT}_js/$CIRCUIT.wasm" "$OUT_DIR/$CIRCUIT.wasm"
cp "$BUILD_DIR/${CIRCUIT}_final.zkey" "$OUT_DIR/$CIRCUIT.zkey"

CIRCOM_SRC="$CIRCUIT_DIR/$CIRCUIT.circom" \
MANIFEST_OUT="$OUT_DIR/$CIRCUIT.manifest.json" \
node -e '
const fs = require("fs");
const crypto = require("crypto");
const src = fs.readFileSync(process.env.CIRCOM_SRC, "utf8").replace(/\r\n/g, "\n");
const manifest = {
  circuit: "student_access_pass.circom",
  circuitSha256: crypto.createHash("sha256").update(src).digest("hex"),
  publicSignals: ["root", "epoch", "nullifierHash"],
  commitmentScheme: "poseidon-bn254-merkle16",
  ceremonyPower: 14
};
fs.writeFileSync(process.env.MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
'

VKEY_OUT="$OUT_DIR/${CIRCUIT}_vkey.json" \
node -e '
const fs = require("fs");
const key = JSON.parse(fs.readFileSync(process.env.VKEY_OUT, "utf8"));
if (Number(key.nPublic) !== 3) {
  throw new Error("student_access_pass verification key must expose exactly three public signals");
}
'

echo ">> generated student_access_pass.wasm, student_access_pass.zkey, and student_access_pass_vkey.json"
