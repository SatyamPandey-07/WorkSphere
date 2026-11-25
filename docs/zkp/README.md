# Zero-Knowledge Proofs (ZKP) Documentation

## Architecture & Reference

* [Groth16 Circuit Architecture for Student Discounts](./GROTH16_CIRCUIT_ARCHITECTURE.md) — Circom R1CS constraints, BN254 (`alt_bn128`) pairing & trusted setup phases, Web Worker SnarkJS proof generation, public signal validation (`merkleRoot`, `domainHash`, `expirationTimestamp`), performance benchmarks, and threat analysis.
* [Groth16 Circuit Proving Key Verification Benchmark Runbook](./GROTH16_BENCHMARK_RUNBOOK.md) — Comprehensive technical runbook covering Circom compilation, Groth16 trusted setup and ceremony artifacts, `.zkey`/`.vkey` management, SnarkJS proof lifecycle, browser WASM vs Node.js performance benchmarks, mobile memory limits, and IndexedDB proof verification caching.

## Circuit Verification Test Cases

1. **Valid academic domain proof:** Prover with a valid witness in the approved Merkle tree and `expirationTimestamp > now` produces a proof that passes `groth16.verify` and matches `[merkleRoot, domainHash, expirationTimestamp]`.
2. **Invalid / non-academic domain or bad Merkle path:** Altering a path element, `merkleRoot`, or `domainHash` fails constraint / verification checks.
3. **Expired discount credential:** Proof with `expirationTimestamp <= currentTimestamp` is rejected by the verifier / API endpoint.
4. **Tampered or malformed proof / public signals:** Mutating proof points `(pi_a, pi_b, pi_c)` or truncating/reordering `publicSignals` is rejected.
5. **Low-memory Web Worker guard:** Simulating Wasm memory allocation failure in the worker returns a structured error without crashing the main thread and clears temporary buffers.

## Security & Audit Checklist

* [ ] Every private/intermediate signal used in domain and Merkle checks is strictly constrained in R1CS (no unconstrained witness assignments).
* [ ] All boolean/range selectors enforce binary `{0, 1}` constraints before bit-packing or comparisons.
* [ ] `domainHash` does not leak `emailPrefix` or PII in `publicSignals` or logs.
* [ ] Trusted setup Phase 1 (`.ptau`) and Phase 2 (`.zkey`) artifacts are checksum-verified and match the deployed `verification_key.json`.
* [ ] Verifier / API enforces `merkleRoot` allowlist, `domainHash` check, and `expirationTimestamp` freshness, and guards against proof replay/malleability.