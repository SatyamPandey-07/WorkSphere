#!/usr/bin/env bash
# Build and verify WorkSphere Nomad Passport Groth16 artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT="nomad_productivity_proof"
CIRCUIT_FILE="$ROOT/circuits/$CIRCUIT.circom"
BUILD_DIR="$ROOT/circuits/build"
OUT_DIR="$ROOT/public/zkp"

PTAU_NAME="powersOfTau28_hez_final_12.ptau"
PTAU_URL="${NOMAD_PTAU_URL:-https://circom.info/$PTAU_NAME}"

# This published digest is BLAKE2b-512, NOT SHA-256.
PTAU_BLAKE2B512="ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a"

PTAU="$BUILD_DIR/$PTAU_NAME"
R1CS="$BUILD_DIR/$CIRCUIT.r1cs"
WASM="$BUILD_DIR/${CIRCUIT}_js/${CIRCUIT}.wasm"
INITIAL_ZKEY="$BUILD_DIR/${CIRCUIT}_0000.zkey"
FINAL_ZKEY="$BUILD_DIR/${CIRCUIT}_final.zkey"
VKEY="$OUT_DIR/${CIRCUIT}_vkey.json"

mkdir -p "$BUILD_DIR" "$OUT_DIR"

for tool in node npx curl openssl; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: required tool '$tool' is unavailable" >&2
    exit 1
  }
done

if [[ ! -f "$ROOT/node_modules/circomlib/circuits/poseidon.circom" ]]; then
  echo "error: circomlib is missing. Run npm install." >&2
  exit 1
fi

# Compile the circuit.
echo ">> compiling Nomad circuit"

if [[ -n "${CIRCOM_BIN:-}" ]]; then
  "$CIRCOM_BIN" "$CIRCUIT_FILE" \
    --r1cs --wasm --sym \
    -l "$ROOT/node_modules" \
    -o "$BUILD_DIR"
else
  (
    cd "$ROOT"
    npx circom2 "$CIRCUIT_FILE" \
      --r1cs --wasm --sym \
      -l "$ROOT/node_modules" \
      -o "$BUILD_DIR"
  )
fi

[[ -s "$R1CS" ]] || {
  echo "error: circuit R1CS was not generated" >&2
  exit 1
}

[[ -s "$WASM" ]] || {
  echo "error: circuit WASM was not generated" >&2
  exit 1
}

# Download Powers of Tau if necessary.
if [[ ! -f "$PTAU" ]]; then
  echo ">> downloading Powers of Tau"
  curl -fL --retry 3 "$PTAU_URL" -o "$PTAU"
fi

# Verify the exact published file digest.
echo ">> verifying Powers of Tau checksum"

ACTUAL_BLAKE2B512="$(
  node -e "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('blake2b512').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$PTAU"
)"

if [[ "$ACTUAL_BLAKE2B512" != "$PTAU_BLAKE2B512" ]]; then
  echo "error: Powers of Tau BLAKE2b-512 checksum mismatch" >&2
  exit 1
fi

# Verify the ceremony contributions cryptographically.
echo ">> verifying Powers of Tau ceremony"
npx --prefix "$ROOT" snarkjs powersoftau verify "$PTAU"

echo ">> inspecting circuit constraints"
npx --prefix "$ROOT" snarkjs r1cs info "$R1CS"

# Remove stale temporary keys before generating a fresh setup.
rm -f "$INITIAL_ZKEY" "$FINAL_ZKEY"

echo ">> generating Groth16 initial key"
npx --prefix "$ROOT" snarkjs groth16 setup \
  "$R1CS" \
  "$PTAU" \
  "$INITIAL_ZKEY"

# Generate a fresh, unpredictable contribution.
ZKEY_ENTROPY="$(openssl rand -hex 32)"
trap 'unset ZKEY_ENTROPY || true' EXIT

echo ">> contributing fresh Groth16 entropy"
npx --prefix "$ROOT" snarkjs zkey contribute \
  "$INITIAL_ZKEY" \
  "$FINAL_ZKEY" \
  --name="WorkSphere Nomad contributor" \
  -e="$ZKEY_ENTROPY"

unset ZKEY_ENTROPY
trap - EXIT

# Verify the final proving key against the circuit and ceremony.
echo ">> verifying final Groth16 proving key"
npx --prefix "$ROOT" snarkjs zkey verify \
  "$R1CS" \
  "$PTAU" \
  "$FINAL_ZKEY"

# Export the dedicated verification key.
echo ">> exporting verification key"
npx --prefix "$ROOT" snarkjs zkey export verificationkey \
  "$FINAL_ZKEY" \
  "$VKEY"

# Install runtime artifacts.
cp "$WASM" "$OUT_DIR/$CIRCUIT.wasm"
cp "$FINAL_ZKEY" "$OUT_DIR/$CIRCUIT.zkey"

for artifact in \
  "$OUT_DIR/$CIRCUIT.wasm" \
  "$OUT_DIR/$CIRCUIT.zkey" \
  "$VKEY"; do
  [[ -s "$artifact" ]] || {
    echo "error: required runtime artifact is missing: $artifact" >&2
    exit 1
  }
done

# Generate a reproducible source/artifact manifest.
echo ">> writing Nomad artifact manifest"

CIRCOM_SRC="$CIRCUIT_FILE" \
CIRCOMLIB_PKG="$ROOT/node_modules/circomlib/package.json" \
R1CS_FILE="$R1CS" \
WASM_FILE="$OUT_DIR/$CIRCUIT.wasm" \
ZKEY_FILE="$OUT_DIR/$CIRCUIT.zkey" \
VKEY_FILE="$VKEY" \
PTAU_FILE="$PTAU" \
PTAU_BLAKE2B512="$PTAU_BLAKE2B512" \
MANIFEST_OUT="$OUT_DIR/$CIRCUIT.manifest.json" \
node -e '
const fs = require("fs");
const crypto = require("crypto");

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const source = fs.readFileSync(process.env.CIRCOM_SRC, "utf8").replace(/\r\n/g, "\n");
const circomlib = JSON.parse(fs.readFileSync(process.env.CIRCOMLIB_PKG, "utf8"));

const manifest = {
  circuit: "nomad_productivity_proof.circom",
  circuitSha256: crypto.createHash("sha256").update(source).digest("hex"),
  commitmentScheme: "poseidon-bn254-activity-bound",
  circomlibVersion: circomlib.version,
  powersOfTau: {
    file: "powersOfTau28_hez_final_12.ptau",
    checksumAlgorithm: "BLAKE2b-512",
    checksum: process.env.PTAU_BLAKE2B512
  },
  publicSignals: [
    "nullifierHash",
    "minThresholdStreak",
    "minThresholdHours",
    "epoch",
    "expectedCommitment"
  ],
  runtimeArtifacts: {
    wasmSha256: sha256(process.env.WASM_FILE),
    zkeySha256: sha256(process.env.ZKEY_FILE),
    verificationKeySha256: sha256(process.env.VKEY_FILE)
  }
};

fs.writeFileSync(process.env.MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
'

echo ">> Nomad Groth16 artifacts verified and installed in public/zkp"