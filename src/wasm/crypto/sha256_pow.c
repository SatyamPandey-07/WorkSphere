/**
 * sha256_pow.c
 * C implementation of the SHA-256 hashing algorithm optimized for rapid
 * proof-of-work verification and nonce mining.
 * Prevents 32-bit shift overflows under extreme difficulty settings via 256-bit target arrays (#5611).
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#define SHA256_BLOCK_SIZE 32
#define MAX_DIFFICULTY_BITS 256

static const uint32_t k[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

#define ROTRIGHT(word, bits) (((word) >> (bits)) | ((word) << (32 - (bits))))
#define SSIG0(x) (ROTRIGHT(x, 2) ^ ROTRIGHT(x, 13) ^ ROTRIGHT(x, 22))
#define SSIG1(x) (ROTRIGHT(x, 6) ^ ROTRIGHT(x, 11) ^ ROTRIGHT(x, 25))
#define CH(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0(x) (ROTRIGHT(x, 2) ^ ROTRIGHT(x, 13) ^ ROTRIGHT(x, 22))
#define EP1(x) (ROTRIGHT(x, 6) ^ ROTRIGHT(x, 11) ^ ROTRIGHT(x, 25))
#define SIG0(x) (ROTRIGHT(x, 7) ^ ROTRIGHT(x, 18) ^ ((x) >> 3))
#define SIG1(x) (ROTRIGHT(x, 17) ^ ROTRIGHT(x, 19) ^ ((x) >> 10))

typedef struct {
  uint8_t data[64];
  uint32_t datalen;
  uint64_t bitlen;
  uint32_t state[8];
} SHA256_CTX;

static void sha256_transform(SHA256_CTX *ctx, const uint8_t data[]) {
  uint32_t a, b, c, d, e, f, g, h, i, j, t1, t2, m[64];

  for (i = 0, j = 0; i < 16; ++i, j += 4)
    m[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) |
           (data[j + 3]);
  for (; i < 64; ++i)
    m[i] = SIG1(m[i - 2]) + m[i - 7] + SIG0(m[i - 15]) + m[i - 16];

  a = ctx->state[0];
  b = ctx->state[1];
  c = ctx->state[2];
  d = ctx->state[3];
  e = ctx->state[4];
  f = ctx->state[5];
  g = ctx->state[6];
  h = ctx->state[7];

  for (i = 0; i < 64; ++i) {
    t1 = h + EP1(e) + CH(e, f, g) + k[i] + m[i];
    t2 = EP0(a) + MAJ(a, b, c);
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }

  ctx->state[0] += a;
  ctx->state[1] += b;
  ctx->state[2] += c;
  ctx->state[3] += d;
  ctx->state[4] += e;
  ctx->state[5] += f;
  ctx->state[6] += g;
  ctx->state[7] += h;
}

void sha256_init(SHA256_CTX *ctx) {
  ctx->datalen = 0;
  ctx->bitlen = 0;
  ctx->state[0] = 0x6a09e667;
  ctx->state[1] = 0xbb67ae85;
  ctx->state[2] = 0x3c6ef372;
  ctx->state[3] = 0xa54ff53a;
  ctx->state[4] = 0x510e527f;
  ctx->state[5] = 0x9b05688c;
  ctx->state[6] = 0x1f83d9ab;
  ctx->state[7] = 0x5be0cd19;
}

void sha256_update(SHA256_CTX *ctx, const uint8_t data[], size_t len) {
  for (size_t i = 0; i < len; ++i) {
    ctx->data[ctx->datalen] = data[i];
    ctx->datalen++;
    if (ctx->datalen == 64) {
      sha256_transform(ctx, ctx->data);
      ctx->bitlen += 512;
      ctx->datalen = 0;
    }
  }
}

void sha256_final(SHA256_CTX *ctx, uint8_t hash[]) {
  uint32_t i = ctx->datalen;
  if (ctx->datalen < 56) {
    ctx->data[i++] = 0x80;
    while (i < 56)
      ctx->data[i++] = 0x00;
  } else {
    ctx->data[i++] = 0x80;
    while (i < 64)
      ctx->data[i++] = 0x00;
    sha256_transform(ctx, ctx->data);
  }
  ctx->bitlen += ctx->datalen * 8;
  ctx->data[63] = ctx->bitlen;
  ctx->data[62] = ctx->bitlen >> 8;
  ctx->data[61] = ctx->bitlen >> 16;
  ctx->data[60] = ctx->bitlen >> 24;
  ctx->data[59] = ctx->bitlen >> 32;
  ctx->data[58] = ctx->bitlen >> 40;
  ctx->data[57] = ctx->bitlen >> 48;
  ctx->data[56] = ctx->bitlen >> 56;
  sha256_transform(ctx, ctx->data);

  for (i = 0; i < 4; ++i) {
    for (int j = 0; j < 8; ++j) {
      hash[i + (j * 4)] = (ctx->state[j] >> (24 - i * 8)) & 0x000000ff;
    }
  }
}

/**
 * Validates difficulty parameter bounds to guard against negative numbers
 * or values exceeding the 256-bit hash size (#5611).
 * Returns true if valid (0 <= difficulty <= 256), false otherwise.
 */
bool validate_difficulty(int difficulty) {
  if (difficulty < 0 || difficulty > MAX_DIFFICULTY_BITS) {
    return false;
  }
  return true;
}

/**
 * Constructs a 256-bit target comparison byte array from a bit difficulty requirement.
 * Eliminates undefined 32-bit integer shift overflows by working across the full 32-byte array.
 * Target threshold = 2^(256 - difficulty) - 1.
 * Any hash <= target satisfies the difficulty requirement.
 */
int compute_target_256(int difficulty_bits, uint8_t target[32]) {
  if (!target) return -1;
  if (!validate_difficulty(difficulty_bits)) {
    // For invalid difficulty, zero out target completely (unreachable)
    memset(target, 0x00, 32);
    return -1;
  }

  memset(target, 0x00, 32);

  if (difficulty_bits == 0) {
    // 0 bits difficulty: entire target is 0xFF (any hash passes)
    memset(target, 0xFF, 32);
    return 0;
  }

  if (difficulty_bits >= MAX_DIFFICULTY_BITS) {
    // 256 bits difficulty: all zeros (only hash == 0 passes)
    memset(target, 0x00, 32);
    return 0;
  }

  int full_zero_bytes = difficulty_bits / 8;
  int remaining_zero_bits = difficulty_bits % 8;

  // Leading bytes are set to 0x00
  for (int i = 0; i < full_zero_bytes; i++) {
    target[i] = 0x00;
  }

  // The transitional byte has (8 - remaining_zero_bits) trailing 1s
  if (full_zero_bytes < 32) {
    target[full_zero_bytes] = (uint8_t)(0xFF >> remaining_zero_bits);
  }

  // All remaining trailing bytes are set to 0xFF
  for (int i = full_zero_bytes + 1; i < 32; i++) {
    target[i] = 0xFF;
  }

  return 0;
}

/**
 * Compares two 256-bit big-endian byte arrays (hash vs target).
 * Returns:
 *   -1 if hash < target (valid proof-of-work)
 *    0 if hash == target (valid proof-of-work)
 *    1 if hash > target (exceeds target, invalid)
 */
int compare_hash_target(const uint8_t hash[32], const uint8_t target[32]) {
  if (!hash || !target) return 1;
  for (int i = 0; i < 32; i++) {
    if (hash[i] < target[i]) return -1;
    if (hash[i] > target[i]) return 1;
  }
  return 0;
}

/**
 * Counts leading zero bits in a 32-byte SHA-256 hash without 32-bit shift overflows.
 */
int count_leading_zero_bits(const uint8_t hash[32]) {
  if (!hash) return 0;
  int leading_zeros = 0;
  for (int i = 0; i < 32; i++) {
    if (hash[i] == 0) {
      leading_zeros += 8;
    } else {
      uint8_t byte = hash[i];
      while ((byte & 0x80) == 0) {
        leading_zeros++;
        byte <<= 1;
      }
      break;
    }
  }
  return leading_zeros;
}

/**
 * Verifies a proof-of-work submission against a 256-bit target array.
 * Returns 1 on success (hash <= target), 0 on failure.
 */
int verify_pow_target(const uint8_t *data, size_t len, const uint8_t *nonce,
                      size_t nonce_len, const uint8_t target[32]) {
  if (!data || !nonce || !target) return 0;

  SHA256_CTX ctx;
  uint8_t hash[32];

  sha256_init(&ctx);
  sha256_update(&ctx, data, len);
  sha256_update(&ctx, nonce, nonce_len);
  sha256_final(&ctx, hash);

  return compare_hash_target(hash, target) <= 0 ? 1 : 0;
}

/**
 * Main WebAssembly export for verifying proof-of-work with integer difficulty.
 * Safely guards against negative difficulty and overflows >= 32 bits (#5611).
 * Returns 1 if valid, 0 if invalid or parameters out of bounds.
 */
int verify_pow(const uint8_t *data, size_t len, const uint8_t *nonce,
               size_t nonce_len, int difficulty) {
  if (!data || !nonce) return 0;
  if (!validate_difficulty(difficulty)) {
    return 0; // Guard against negative or >256 difficulty
  }

  uint8_t target[32];
  if (compute_target_256(difficulty, target) != 0) {
    return 0;
  }

  return verify_pow_target(data, len, nonce, nonce_len, target);
}

/**
 * Mines a valid nonce satisfying the requested difficulty within max_iterations.
 * Returns 1 if found, 0 if max_iterations exceeded, -1 if invalid parameters.
 */
int mine_pow(const uint8_t *data, size_t len, uint8_t *nonce_out, size_t nonce_len,
             int difficulty, uint64_t max_iterations, uint64_t *iterations_out) {
  if (!data || !nonce_out || nonce_len < 8) return -1;
  if (!validate_difficulty(difficulty)) return -1;

  uint8_t target[32];
  if (compute_target_256(difficulty, target) != 0) return -1;

  uint64_t nonce_val = 0;
  SHA256_CTX ctx_base;
  sha256_init(&ctx_base);
  sha256_update(&ctx_base, data, len);

  for (uint64_t iter = 0; iter < max_iterations; ++iter) {
    SHA256_CTX ctx = ctx_base;
    uint8_t nonce_bytes[8];
    for (int b = 0; b < 8; b++) {
      nonce_bytes[7 - b] = (uint8_t)((nonce_val >> (b * 8)) & 0xFF);
    }

    sha256_update(&ctx, nonce_bytes, 8);
    uint8_t hash[32];
    sha256_final(&ctx, hash);

    if (compare_hash_target(hash, target) <= 0) {
      memcpy(nonce_out, nonce_bytes, 8);
      if (iterations_out) *iterations_out = iter + 1;
      return 1; // Solution found!
    }

    nonce_val++;
  }

  if (iterations_out) *iterations_out = max_iterations;
  return 0; // Exceeded max_iterations
}
