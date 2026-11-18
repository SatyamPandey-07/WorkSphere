# Schnorr Threshold Signature Aggregator Documentation

## Overview

This document specifies the multi-party threshold Schnorr signature aggregation protocol, Shamir polynomial evaluation, and Lagrange coefficient interpolation implemented in `src/core/crypto/SchnorrThresholdAggregator.ts`.

---

## 1. Protocol Walkthrough ($t$-of-$n$ Threshold Signing)

### Round 1: Nonce Commitments

Participants generate secret nonces $(r_{i,1}, r_{i,2})$ and publish public nonce commitments $(R_{i,1} = r_{i,1}G, R_{i,2} = r_{i,2}G)$. An aggregate nonce $R$ is formed using a binding factor $b$ derived from all commitments and the message:
$$R = \sum_{i=1}^{n} (R_{i,1} + b \cdot R_{i,2})$$

### Round 2: Partial Signature Generation

Each participant computes a partial signature share $s_i$ using their secret key $x_i$, key coefficient $c_i$, and the challenge $e$:
$$s_i = (r_{i,1} + b \cdot r_{i,2}) + e \cdot c_i \cdot x_i \pmod n$$

---

## 2. Security Considerations & Resistance

- **Rogue-Key Attacks:** Prevented by lexicographically sorting public keys and applying MuSig2 coefficient hashing ($c_i$).
- **Key-Cancellation Attacks:** Mitigated by binding public key coefficients securely into the aggregation step.
- **Nonce Reuse Prevention:** Enforces strict state tracking and single-use nonces per signing session.

---

## 3. Timeouts & Fault Identification

- **Timeouts:** Sessions automatically transition to an aborted state if partial signatures or nonces are not collected within the designated timeout window.
- **Validator Fault Identification:** Batch verification uses randomized 128-bit scalar weights to detect invalid submissions and isolate rogue validator IDs upon failure.
