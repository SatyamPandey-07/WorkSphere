# WebAssembly Digital Signature Verification Guide

## Purpose

This guide describes how to verify digital signatures embedded in PDF receipts in a WebAssembly-enabled application. It covers four separate responsibilities:

1. Compiling the required OpenSSL functionality to WebAssembly.
2. Parsing a PDF signature's `/ByteRange` and `/Contents` values.
3. Verifying detached CMS/PKCS#7 signatures, including RSA and ECDSA signers.
4. Rendering an accurate, accessible verification result in a receipt modal.

Cryptographic verification must use the original PDF bytes. Do **not** verify text extracted from the PDF, a rendered canvas, a re-saved PDF, or a hash supplied by an untrusted source.

## Verification flow

```text
Original PDF ArrayBuffer
        |
        v
Parse signature dictionary (/ByteRange, /Contents)
        |
        +--> validate ranges and decode CMS DER
        |
        v
Concatenate the exact signed byte ranges
        |
        v
OpenSSL CMS_verify() + certificate-chain policy
        |
        v
Typed verification result
        |
        v
Receipt modal status and details
```

Keep PDF parsing, cryptographic verification, certificate policy, and UI rendering in separate modules. A signature dictionary or a signer name is not evidence that a document is trusted.

## Compiling OpenSSL for WebAssembly

Pin the OpenSSL release and Emscripten version in source control. The build record should include their versions, source checksums, configuration flags, and the checksum of the resulting WASM asset.

OpenSSL must retain the CMS, ASN.1, X.509, RSA, EC, and approved digest algorithms required by the verification policy. Build only the features needed for verification, but do not remove dependencies merely to reduce bundle size without testing the complete signature corpus.

Example build outline:

```bash
export CC=emcc
export AR=emar
export RANLIB=emranlib

./Configure linux-generic32 no-shared no-async no-tests no-apps \
  --prefix="$PWD/dist"
make -j
make install_sw

em++ -O3 -std=c++20 verification_bindings.cpp \
  -I dist/include -L dist/lib -lcrypto \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -o public/openssl-verifier.js
```

Run verification in a Web Worker when possible so that large PDFs cannot block the receipt UI. Production builds should not expose debug interfaces, test trust roots, arbitrary filesystem access, or dynamic-loading features unless a reviewed requirement needs them.

## C++ OpenSSL binding

The binding below accepts the exact reconstructed signed bytes, DER-encoded CMS data, and a controlled PEM trust bundle. Its public contract is a stable result code; raw OpenSSL errors should be used only for protected diagnostics.

```cpp
#include <cstdint>
#include <cstddef>
#include <emscripten/emscripten.h>
#include <openssl/bio.h>
#include <openssl/cms.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509_vfy.h>

enum VerifyCode : int {
  kValid = 0,
  kInvalidSignature = 1,
  kUntrustedCertificate = 2,
  kMalformedCms = 3,
  kInternalError = 4,
};

extern "C" EMSCRIPTEN_KEEPALIVE
int verify_detached_cms(const uint8_t* signed_data, size_t signed_length,
                        const uint8_t* cms_der, size_t cms_length,
                        const char* trust_pem) {
  int result = kInternalError;
  BIO* content = nullptr;
  BIO* trust_bio = nullptr;
  CMS_ContentInfo* cms = nullptr;
  X509_STORE* store = nullptr;

  if (!signed_data || !cms_der || !trust_pem) return kMalformedCms;

  const unsigned char* cursor = cms_der;
  cms = d2i_CMS_ContentInfo(nullptr, &cursor, static_cast<long>(cms_length));
  if (!cms || cursor != cms_der + cms_length) {
    result = kMalformedCms;
    goto done;
  }

  content = BIO_new_mem_buf(signed_data, static_cast<int>(signed_length));
  trust_bio = BIO_new_mem_buf(trust_pem, -1);
  store = X509_STORE_new();
  if (!content || !trust_bio || !store) goto done;

  for (;;) {
    X509* root = PEM_read_bio_X509(trust_bio, nullptr, nullptr, nullptr);
    if (!root) break;
    const int added = X509_STORE_add_cert(store, root);
    X509_free(root);
    if (added != 1) goto done;
  }
  ERR_clear_error(); // EOF after the final PEM certificate is expected.

  if (CMS_verify(cms, nullptr, store, content, nullptr,
                 CMS_BINARY | CMS_DETACHED) == 1) {
    result = kValid;
  } else {
    // Production code must map known verification errors to distinct result codes.
    result = kInvalidSignature;
  }

done:
  BIO_free(content);
  BIO_free(trust_bio);
  X509_STORE_free(store);
  CMS_ContentInfo_free(cms);
  ERR_clear_error();
  return result;
}
```

The example is deliberately minimal. Product policy must additionally configure certificate purpose and key usage, validate intermediate certificates, distinguish chain failures from signature failures, and define a revocation and trusted-timestamp policy. Do not set verification time from an untrusted PDF field.

## Parsing a PDF signature

PDF signatures generally contain these entries in a signature dictionary:

- `/ByteRange [offset0 length0 offset1 length1]`: byte intervals covered by the signature.
- `/Contents <...>`: a hexadecimal CMS/PKCS#7 object, commonly padded with trailing zero bytes to reserve space for signing.

The signed message is the ordered concatenation of the two `/ByteRange` intervals. The `/Contents` region is normally excluded from those intervals.

### Parsing algorithm

1. Preserve the uploaded PDF as an immutable `Uint8Array`; all offsets refer to these original bytes.
2. Parse indirect objects and locate the selected signature dictionary. Do not rely solely on a regular expression: strings, streams, incremental updates, and duplicate keys make that unsafe.
3. Parse `/ByteRange` as exactly four non-negative decimal integers.
4. Reject integer overflow, out-of-bounds intervals, overlap, reversed order, or ranges that do not match the document boundaries expected by the signature profile.
5. Copy `pdf[offset0 : offset0 + length0]`, followed by `pdf[offset1 : offset1 + length1]`, without normalizing whitespace or line endings.
6. Decode `/Contents` as hex after removing only permitted PDF whitespace. Reject odd-length input and non-hex characters.
7. DER-decode exactly one CMS object. If the fixed-width PDF field contains padding, allow only trailing `0x00` bytes after the DER object’s declared end; do not discard interior bytes.
8. Require a detached CMS signature and send the concatenated bytes and CMS DER to the verifier.

### TypeScript-oriented pseudocode

```ts
type ByteRange = readonly [number, number, number, number];

function signedBytes(pdf: Uint8Array, range: ByteRange): Uint8Array {
  const [startA, lengthA, startB, lengthB] = range;
  const endA = checkedAdd(startA, lengthA, pdf.length);
  const endB = checkedAdd(startB, lengthB, pdf.length);

  if (startA !== 0 || startB < endA || endB !== pdf.length) {
    throw new Error("invalid PDF ByteRange");
  }

  const output = new Uint8Array(lengthA + lengthB);
  output.set(pdf.subarray(startA, endA), 0);
  output.set(pdf.subarray(startB, endB), lengthA);
  return output;
}

function cmsFromContents(hexContents: string): Uint8Array {
  const compact = hexContents.replace(/[\u0000\u0009\u000A\u000C\u000D\u0020]/g, "");
  if (compact.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(compact)) {
    throw new Error("invalid CMS hex content");
  }
  return derSliceExactlyOneCmsObject(hexToBytes(compact));
}
```

PDFs can contain several signatures and incremental revisions. Identify the signature object explicitly, validate each independently, and report the revision it covers. An older signature can remain cryptographically valid after an append-only update; that does not mean the signature covers all currently displayed content.

## RSA, ECDSA, and certificate policy

Use an explicit allowlist, not a blocklist. A practical baseline is:

- RSA-PSS with SHA-256 or stronger.
- RSA PKCS#1 v1.5 with SHA-256 or stronger only where legacy compatibility requires it.
- ECDSA with SHA-256 or stronger on approved curves such as P-256 and P-384.
- RSA public keys of at least 2048 bits.

Reject MD5 and SHA-1, weak RSA keys, unsupported curves, malformed ECDSA encodings, and unknown critical certificate extensions. Validate the signer chain against an application-controlled trust store, constrain acceptable key usage and extended key usage, and define whether revocation is checked online, from cached evidence, or reported as unavailable. A trusted signing time may be used only after validating the timestamp authority and timestamp token.

`CMS_verify` authenticates the CMS structure and its signed content when supplied the correct detached data. It does not replace the application’s trust, revocation, timestamp, or signer-identity policy.

## Receipt modal rendering

The modal presents the result of verification; it must not make cryptographic decisions or label a document valid merely because it has a signature field.

```ts
type VerificationResult = {
  status: "valid" | "invalid" | "untrusted" | "expired" | "unsupported" | "error";
  signerDisplayName?: string;
  signedAt?: string;       // Present only when timestamp policy has passed.
  coveredRevision?: number;
  detailsCode: string;
};
```

Rendering requirements:

- Begin with a neutral **Verifying signature…** state and disable actions that depend on trust.
- Show success only when the signature is cryptographically valid and the certificate chain and policy are accepted.
- Use separate language for invalid signatures, untrusted signers, expired certificates, unsupported algorithms, and processing errors.
- Show signer identity, trust source, timestamp status, covered revision, and a stable diagnostic code in a details section.
- Escape all certificate and PDF-derived values using framework text rendering. Never pass them to `innerHTML`.
- Provide visible text in addition to icons, announce completion with an appropriate status/live region, manage focus when the modal opens and closes, and do not rely on color alone.
- Keep raw OpenSSL error queues, certificate serials, and complete document data out of default UI and analytics logs.

## Security audit procedures

Run this review before release and after any OpenSSL, compiler, parser, trust-store, or policy change.

### Build and supply chain

- Verify pinned source hashes, compiler versions, build configuration, and reproducible WASM artifact hashes.
- Track relevant OpenSSL security advisories and rebuild for applicable fixes.
- Generate an SBOM and scan dependencies in CI.
- Confirm that release builds exclude development trust anchors, test certificates, and debug-only exports.

### Parser and cryptography tests

- Test valid RSA and ECDSA PDFs, multiple signatures, incremental updates, non-ASCII metadata, and large documents.
- Test modifications in each signed range, modified `/Contents`, malformed DER lengths, odd/non-hex content, duplicate PDF keys, and malformed or out-of-range byte ranges.
- Test detached-versus-embedded CMS mismatches, weak digests, undersized keys, disallowed curves, malformed ECDSA signatures, expired/untrusted/revoked chains, and unknown critical extensions.
- Fuzz the PDF dictionary parser, DER input boundaries, and WASM binding using strict input-size, memory, and execution-time limits.

### Trust and UI review

- Review trust-anchor ownership, intermediate handling, certificate rotation, revocation behavior, timestamp authority policy, and offline behavior.
- Confirm no failure path can be displayed as “valid,” including parser errors, timeouts, chain failures, and unsupported algorithms.
- Test hostile certificate subjects and PDF metadata for XSS, bidi spoofing, misleading Unicode, layout overflow, and accessibility regressions.
- Log only privacy-reviewed stable result codes; do not log full receipts, CMS blobs, private keys, or unredacted certificate data without an approved retention policy.

## Release evidence

Keep a version-controlled set of signed and tampered PDF fixtures with expected result codes. Every release should record the verifier version, OpenSSL version, trust-policy version, selected signature object, and verification timestamp. If server-side verification exists, treat it as an independent check rather than a substitute for correctly verifying the uploaded bytes.
