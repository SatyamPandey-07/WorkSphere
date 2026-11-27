# WorkSphere Flutter Groth16 ZKP Student Verification Bridge (FFI vs. WebView)

Documents the architectural tradeoffs, protocol contract, and phased implementation plan for executing WorkSphere's Circom/SnarkJS Groth16 student discount proof in Flutter (`apps/flutter/`).

---

## 1. Existing Web Proving & Verification Contract

WorkSphere's web ZKP pipeline consists of:

* **Circuits (`circuits/`, `public/zkp/`):**
  * `circuits/student_membership.circom` (`StudentMembership(16)`): Depth-16 Poseidon Merkle tree proof with public inputs `[root, epoch]` and private inputs `secret`, `pathElements[16]`, `pathIndices[16]`. Artifacts: `student_membership.wasm` (~34 KB), `student_membership.zkey` (~2.9 KB), `student_membership_vkey.json` (~3.0 KB).
  * `circuits/student_access_pass.circom` (`StudentAccessPass(16)`): Extends membership with public `nullifierHash === Poseidon(secret, nullifierKey, epoch)` to prevent double-claiming student passes.
  * `circuits/membership_verifier.circom`: Larger venue membership circuit (`membership_verifier.wasm` ~1.7 MB, `membership_verifier.zkey` ~4.1 MB).
* **Worker Memory Limits (`src/workers/zkpWorker.ts`):**
  * `WASM_PAGE_BYTES = 64 * 1024` (64 KiB)
  * `MAX_ZKP_WITNESS_BYTES = 16 * 1024 * 1024` (16 MiB witness payload cap)
  * `maxPages = 1024` (64 MiB default WebAssembly linear memory ceiling)
* **Verifier Output Shape (`src/lib/zkp/studentProofVerifier.ts`):**
  * `Groth16Proof`: `{ pi_a, pi_b, pi_c, protocol?: "groth16", curve?: "bn128" }`
  * `StudentProofPublicSignals`: `[epoch, nullifier, eligibilityRoot, ...extraSignals]` formatted as base-10 integer strings bounded by `DEFAULT_MAX_SIGNAL_DIGITS = 78` (BN254 scalar field).

Any Flutter prover bridge **must** produce `snarkjs`-compatible BN254 Groth16 proofs and keep private inputs (`secret`, `nullifierKey`, Merkle siblings) strictly on-device.

---

## 2. Architecture Options & Tradeoff Matrix

### Option A: Native Rust FFI (`arkworks` / `ark-circom` / Mopro via `flutter_rust_bridge`)

Flutter invokes a compiled Rust static/shared library from a background Dart `Isolate` (`Isolate.run`). Rust computes the witness (from `.wasm` or compiled C++ `witnesscalc`) and executes BN254 Groth16 proving natively via `ark-groth16` / Mopro / `rapidsnark`, then formats `{ pi_a, pi_b, pi_c }` in SnarkJS JSON layout.

### Option B: Headless WebView Bridge (`webview_flutter` / `flutter_inappwebview`)

Flutter hosts a hidden, `offscreen` WebView instance running a local bundled HTML/JS harness (`snarkjs.groth16.fullProve` inside a Web Worker) over `flutter://` / local asset scheme (`assets/zkp/`), passing witness inputs and receiving `{ proof, publicSignals }` via JS channels (`postMessage`).

### Comparison: Latency, Binary Size & Memory Limits

| Dimension | Rust `arkworks` / Mopro FFI (Option A) | Headless WebView + `snarkjs` (Option B) |
| :--- | :--- | :--- |
| **Proof Latency (`StudentMembership(16)`)** | **~50–250 ms** (native ARM64 SIMD/NEON multi-scalar multiplication & multi-threaded NTT; zero WebView boot cost). | **~600–2,000+ ms** (200–600 ms WebView cold start + single-threaded JS/WASM `snarkjs` proving). |
| **Proof Latency (Larger `membership_verifier`, 4.1 MB `.zkey`)** | **~300–900 ms** on mid-range mobile devices. | **~2,500–8,000 ms**; risks UI jank if WebView shares main-thread GPU/compositor priority. |
| **App Binary Size Impact** | **+3 MB to +8 MB per ABI** (`arm64-v8a`, `armeabi-v7a`, `x86_64`, iOS `arm64` `.xcframework`), mitigated by Android App Bundle ABI splits. | **~200–500 KB** Dart/platform plugin glue (reuses OS Android System WebView / iOS `WKWebView`), plus `snarkjs` bundle (~350 KB gzipped). |
| **ZKP Asset Footprint** | Bundles `.zkey` + `.wasm`/witnesscalc (`~37 KB` for `student_membership`; `~5.8 MB` if `membership_verifier` is bundled vs lazy-downloaded with SHA-256 manifest check). | Same `.wasm` + `.zkey` asset budget (`public/zkp/`). |
| **Memory Limits & Stability** | **Predictable native heap** inside a dedicated Dart `Isolate`; avoids browser/WebView 64 MiB WASM page caps and supports explicit zeroization (`zeroize`) of `secret`/`nullifierKey` buffers. | **Constrained by WebView / iOS `WKWebView` Jetsam** (~60–150 MB content-process ceiling). Must enforce `zkpWorker.ts` limits (`64 MiB` / `1024` WASM pages, `16 MiB` witness cap) and handle `onWebContentProcessDidTerminate`. |
| **SnarkJS Compatibility** | Requires explicit G1/G2 coordinate serialization adapter (`pi_b` `[c0, c1]` swap check against `StudentProofVerifier`). | **100% native `snarkjs` parity** with `src/workers/zkpWorker.ts`. |
| **CI / Build Complexity** | High (Rust toolchain, Android NDK, `cargo-ndk`, Xcode XCFramework). | Low (standard Flutter packages, zero native NDK/Rust setup). |

---

## 3. Recommended Implementation Plan

### Phase 1: Headless WebView Bridge (Fast MVP & Exact `snarkjs` Parity)

1. **Asset Bundling:** Package `student_membership.wasm`, `student_membership.zkey`, and a minimal offline `snarkjs` Web Worker harness under `apps/flutter/assets/zkp/`. Load larger circuits (`membership_verifier`) on demand with SHA-256 manifest verification (`membership_verifier.manifest.json`).
2. **Bridge Interface (`ZkpProverService`):**
   ```dart
   abstract interface class ZkpProverService {
     Future<Groth16ProofResult> proveStudentDiscount({
       required StudentWitnessInput input,
       Duration timeout = const Duration(seconds: 30),
     });
     Future<void> cancelActiveProof();
   }
   ```
3. **Lifecycle & Leak Prevention:**
   * Never keep the hidden WebView alive globally after proving completes.
   * On `cancelActiveProof()`, route pop, or widget `dispose()`, send an abort message to the worker, call `controller.loadHtmlString('about:blank')` / destroy the platform WebView controller, and clear witness references from memory so mid-proof navigation cannot leak WebView processes.
4. **Timeout & OOM Fallback:** Map WebView termination or `MEMORY_LIMIT_EXCEEDED` / `MEMORY_GROW_FAILED` errors to a typed `ZkpProverException` and offer user-consented fallback or retry.

### Phase 2: Rust Mopro / `arkworks` FFI (Production Performance & Memory Isolation)

1. **Crate Workspace (`apps/flutter/rust/worksphere_zkp/`):**
   * Use `mopro-ffi` + `ark-circom` (`CircomConfig`, `witnesscalc`) + `ark-groth16` (`Bn254`) generated via `flutter_rust_bridge`.
   * Expose `prove_student_membership(zkey_bytes, wasm_bytes, input_json) -> Result<String, ZkpError>` returning `snarkjs`-formatted `{ proof, publicSignals }`.
2. **Isolate Execution & Zeroization:**
   * Always invoke FFI inside `Isolate.run(...)` so the Flutter UI raster/UI threads stay at 60/120 FPS.
   * Zeroize `secret` and `nullifierKey` Rust buffers immediately after witness synthesis.
3. **Cross-Verification Gate:**
   * Add a golden-vector integration test generating proofs via Rust FFI and verifying them with `snarkjs.groth16.verify` and `StudentProofVerifier` (`src/lib/zkp/studentProofVerifier.ts`) using `student_membership_vkey.json` to guarantee G2 coordinate ordering parity before switching the production feature flag from `WebViewZkpProver` to `FfiZkpProver`.
