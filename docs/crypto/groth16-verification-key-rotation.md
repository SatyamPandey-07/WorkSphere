# Groth16 Zero-Knowledge Proof Verification Pipeline & Verification Key Rotation Runbook

This runbook covers public signal validation and circuit binding, Groth16 pairing verification stages, verification key (`vkey`) schema and integrity checks, zero-downtime key rotation, and rollback/incident steps for `vkey` mismatches or invalid proof batches.

## 1. Public Signal Validation & Circuit Binding

* **Field & Count Bounds:** Validate that every public signal is a valid scalar in the target curve field, non-negative, and matches the expected public signal count.
* **Circuit & Epoch Binding:** Bind `circuitId`, circuit version, epoch, and domain context into public inputs or commitments to prevent cross-circuit or cross-epoch replay.
* **Early Rejection:** Reject out-of-range scalars, malformed encodings, or count mismatches before pairing checks.

## 2. Pairing & Proof Verification Stages

1. **Subgroup & Point Validation:** Verify `pi_a`, `pi_c` on `G1` and `pi_b` on `G2` are valid curve points and not invalid identity points.
2. **Public Input Linear Combination:** Compute `vk_x = IC[0] + sum(publicSignals[i] * IC[i + 1])` on `G1`.
3. **Bilinear Pairing Check:** Evaluate the Groth16 pairing equation over the curve pairing group and reject if the check fails.
4. **Result Reporting:** Return explicit pass/fail status and structured failure codes.

## 3. Verification Key (`vkey`) Schema & Integrity Checks

* **Schema Validation:** Check required Groth16 fields (`protocol`, `curve`, `nPublic`, `vk_alpha_1`, `vk_beta_2`, `vk_gamma_2`, `vk_delta_2`, `IC`) and confirm `IC.length === nPublic + 1`.
* **Integrity Digest:** Verify the `vkey` SHA-256 hash against trusted release metadata or registry anchors prior to activation.
* **Lifecycle Metadata:** Track `keyId`, `circuitId`, `effectiveFrom`, `graceUntil`, and `retiredAt`.

## 4. Zero-Downtime Verification Key Rotation Procedure

1. **Stage New `vkey`:** Publish the candidate `vkey`, verify schema and hash integrity, and test in staging.
2. **Dual-Key Grace Window:** Allow verifiers to accept proofs against both active and outgoing `vkey` entries until `graceUntil` while provers/relayers migrate.
3. **Retire Outgoing Key:** Mark the superseded `vkey` as `retired` after `graceUntil` once in-flight proofs settle.

## 5. Rollback & Incident Response (Key Mismatch or Invalid Proof Batch)

1. **Classify Failure:** Separate `vkey` hash/version mismatches from pairing or public-signal validation failures.
2. **Quarantine Invalid Batch:** Reject or hold invalid proof batches and pause affected batch settlement if error rates spike.
3. **Rollback `vkey`:** Restore the last known-good `vkey`, refresh verifier caches, and verify with a known-good proof.
4. **Document Incident:** Log affected `keyId`s, batch identifiers, root cause, and recovery actions.
