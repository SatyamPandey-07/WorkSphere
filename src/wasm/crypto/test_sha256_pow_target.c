/**
 * test_sha256_pow_target.c
 * Comprehensive test suite verifying 256-bit target difficulty arrays,
 * extreme difficulty boundary checks, and overflow prevention in sha256_pow (#5611).
 */

#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SHA256_BLOCK_SIZE 32
#define MAX_DIFFICULTY_BITS 256

/* Forward declarations of sha256_pow functions */
bool validate_difficulty(int difficulty);
int compute_target_256(int difficulty_bits, uint8_t target[32]);
int compare_hash_target(const uint8_t hash[32], const uint8_t target[32]);
int count_leading_zero_bits(const uint8_t hash[32]);
int verify_pow_target(const uint8_t *data, size_t len, const uint8_t *nonce,
                      size_t nonce_len, const uint8_t target[32]);
int verify_pow(const uint8_t *data, size_t len, const uint8_t *nonce,
               size_t nonce_len, int difficulty);
int mine_pow(const uint8_t *data, size_t len, uint8_t *nonce_out,
             size_t nonce_len, int difficulty, uint64_t max_iterations,
             uint64_t *iterations_out);

/* Helper to print a 32-byte hex array */
static void print_hex(const char *label, const uint8_t *bytes, size_t len) {
  printf("%s: ", label);
  for (size_t i = 0; i < len; i++) {
    printf("%02x", bytes[i]);
  }
  printf("\n");
}

/* Helper to construct a synthetic 32-byte hash with exact leading zeros */
static void create_synthetic_hash(int leading_zero_bits, uint8_t hash[32]) {
  memset(hash, 0xFF, 32);
  if (leading_zero_bits <= 0) return;
  if (leading_zero_bits >= 256) {
    memset(hash, 0x00, 32);
    return;
  }

  int full_bytes = leading_zero_bits / 8;
  int rem_bits = leading_zero_bits % 8;

  for (int i = 0; i < full_bytes; i++) {
    hash[i] = 0x00;
  }

  if (full_bytes < 32 && rem_bits > 0) {
    /* Clear the top rem_bits of this byte */
    uint8_t mask = (uint8_t)(0xFF >> rem_bits);
    hash[full_bytes] = mask;
  }
}

/* ========================================================================= */
/* Test Suite 1: Difficulty Parameter Validation                             */
/* ========================================================================= */
static void test_difficulty_parameter_validation(void) {
  printf("Running Test Suite 1: Difficulty Parameter Validation...\n");

  /* Standard valid difficulties */
  assert(validate_difficulty(0) == true);
  assert(validate_difficulty(1) == true);
  assert(validate_difficulty(8) == true);
  assert(validate_difficulty(16) == true);
  assert(validate_difficulty(31) == true);
  assert(validate_difficulty(32) == true);
  assert(validate_difficulty(64) == true);
  assert(validate_difficulty(128) == true);
  assert(validate_difficulty(255) == true);
  assert(validate_difficulty(256) == true);

  /* Negative difficulties (invalid) */
  assert(validate_difficulty(-1) == false);
  assert(validate_difficulty(-32) == false);
  assert(validate_difficulty(-256) == false);
  assert(validate_difficulty(-99999) == false);

  /* Difficulties beyond 256-bit hash size (invalid) */
  assert(validate_difficulty(257) == false);
  assert(validate_difficulty(258) == false);
  assert(validate_difficulty(512) == false);
  assert(validate_difficulty(1024) == false);
  assert(validate_difficulty(99999) == false);

  printf("  -> Passed difficulty parameter validation tests.\n");
}

/* ========================================================================= */
/* Test Suite 2: 256-Bit Target Array Computation                            */
/* ========================================================================= */
static void test_target_array_computation(void) {
  printf("Running Test Suite 2: 256-Bit Target Array Computation...\n");
  uint8_t target[32];

  /* Case 1: Difficulty = 0 bits -> Target must be all 0xFF */
  assert(compute_target_256(0, target) == 0);
  for (int i = 0; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 2: Difficulty = 1 bit -> Target byte 0 is 0x7F, rest 0xFF */
  assert(compute_target_256(1, target) == 0);
  assert(target[0] == 0x7F);
  for (int i = 1; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 3: Difficulty = 7 bits -> Target byte 0 is 0x01, rest 0xFF */
  assert(compute_target_256(7, target) == 0);
  assert(target[0] == 0x01);
  for (int i = 1; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 4: Difficulty = 8 bits -> Target byte 0 is 0x00, rest 0xFF */
  assert(compute_target_256(8, target) == 0);
  assert(target[0] == 0x00);
  for (int i = 1; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 5: Difficulty = 16 bits -> Target bytes 0..1 are 0x00, rest 0xFF */
  assert(compute_target_256(16, target) == 0);
  assert(target[0] == 0x00);
  assert(target[1] == 0x00);
  for (int i = 2; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 6: Boundary 31 bits (Critical 32-bit boundary) */
  assert(compute_target_256(31, target) == 0);
  assert(target[0] == 0x00);
  assert(target[1] == 0x00);
  assert(target[2] == 0x00);
  assert(target[3] == 0x01); /* 31 bits = 3 bytes 0x00 + 7 bits 0 in byte 3 (0xFF >> 7 = 0x01) */
  for (int i = 4; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 7: Boundary 32 bits (Previous undefined behavior trigger) */
  assert(compute_target_256(32, target) == 0);
  for (int i = 0; i < 4; i++) {
    assert(target[i] == 0x00);
  }
  for (int i = 4; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 8: Boundary 33 bits (Exceeding 32 bits) */
  assert(compute_target_256(33, target) == 0);
  for (int i = 0; i < 4; i++) {
    assert(target[i] == 0x00);
  }
  assert(target[4] == 0x7F); /* 33 = 4 * 8 + 1 bit => 0xFF >> 1 = 0x7F */
  for (int i = 5; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 9: Extreme 64 bits */
  assert(compute_target_256(64, target) == 0);
  for (int i = 0; i < 8; i++) {
    assert(target[i] == 0x00);
  }
  for (int i = 8; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 10: Extreme 128 bits */
  assert(compute_target_256(128, target) == 0);
  for (int i = 0; i < 16; i++) {
    assert(target[i] == 0x00);
  }
  for (int i = 16; i < 32; i++) {
    assert(target[i] == 0xFF);
  }

  /* Case 11: Extreme 255 bits */
  assert(compute_target_256(255, target) == 0);
  for (int i = 0; i < 31; i++) {
    assert(target[i] == 0x00);
  }
  assert(target[31] == 0x01);

  /* Case 12: Extreme 256 bits (All zeros) */
  assert(compute_target_256(256, target) == 0);
  for (int i = 0; i < 32; i++) {
    assert(target[i] == 0x00);
  }

  /* Case 13: Invalid difficulty (< 0 or > 256) returns -1 */
  assert(compute_target_256(-1, target) == -1);
  assert(compute_target_256(257, target) == -1);
  assert(compute_target_256(500, target) == -1);

  printf("  -> Passed 256-bit target array computation tests.\n");
}

/* ========================================================================= */
/* Test Suite 3: Hash vs. Target 256-Bit Lexicographical Comparison          */
/* ========================================================================= */
static void test_hash_target_comparison(void) {
  printf("Running Test Suite 3: Hash vs Target Comparison...\n");
  uint8_t target[32];
  uint8_t hash[32];

  /* Compute target for difficulty 16 */
  compute_target_256(16, target);

  /* Case A: Exact equality (hash == target) */
  memcpy(hash, target, 32);
  assert(compare_hash_target(hash, target) == 0);

  /* Case B: Hash is smaller (valid PoW) */
  memcpy(hash, target, 32);
  hash[31] -= 1; /* Slightly lower in least significant byte */
  assert(compare_hash_target(hash, target) == -1);

  /* Case C: Hash is strictly zero (valid PoW) */
  memset(hash, 0x00, 32);
  assert(compare_hash_target(hash, target) == -1);

  /* Case D: Hash has more leading zeros than target */
  compute_target_256(16, target);
  create_synthetic_hash(20, hash);
  assert(compare_hash_target(hash, target) == -1);

  /* Case E: Hash is greater than target (invalid PoW) */
  compute_target_256(16, target);
  memcpy(hash, target, 32);
  hash[1] = 0x01; /* 1 in byte 1 where target has 0x00 */
  assert(compare_hash_target(hash, target) == 1);

  /* Case F: Null pointers safe handling */
  assert(compare_hash_target(NULL, target) == 1);
  assert(compare_hash_target(hash, NULL) == 1);

  printf("  -> Passed hash vs target comparison tests.\n");
}

/* ========================================================================= */
/* Test Suite 4: Leading Zero Bit Counting                                   */
/* ========================================================================= */
static void test_count_leading_zero_bits(void) {
  printf("Running Test Suite 4: Leading Zero Bit Counting...\n");
  uint8_t hash[32];

  /* All 0xFF -> 0 leading zeros */
  memset(hash, 0xFF, 32);
  assert(count_leading_zero_bits(hash) == 0);

  /* Test single bit boundaries from 1 to 256 bits */
  for (int bits = 0; bits <= 256; bits++) {
    create_synthetic_hash(bits, hash);
    int zeros = count_leading_zero_bits(hash);
    assert(zeros == bits);
  }

  /* Null pointer check */
  assert(count_leading_zero_bits(NULL) == 0);

  printf("  -> Passed leading zero bit counting tests.\n");
}

/* ========================================================================= */
/* Test Suite 5: Extreme Difficulty Proof-of-Work Verification               */
/* ========================================================================= */
static void test_extreme_difficulty_verification(void) {
  printf("Running Test Suite 5: Extreme Difficulty PoW Verification...\n");

  const uint8_t test_data[] = "WorkSphere-Telemetry-Payload-2026";
  const size_t test_data_len = sizeof(test_data) - 1;
  const uint8_t nonce[] = "nonce12345";
  const size_t nonce_len = sizeof(nonce) - 1;

  /* Test 1: Difficulty 0 always passes */
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, 0) == 1);

  /* Test 2: Negative difficulty is rejected immediately without looping */
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, -1) == 0);
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, -32) == 0);
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, -100) == 0);

  /* Test 3: Extreme difficulty > 256 is rejected immediately */
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, 257) == 0);
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, 500) == 0);
  assert(verify_pow(test_data, test_data_len, nonce, nonce_len, 1000) == 0);

  /* Test 4: Extreme difficulty 256 requires absolute zero hash */
  uint8_t target_256[32];
  compute_target_256(256, target_256);
  uint8_t zero_hash[32];
  memset(zero_hash, 0x00, 32);
  assert(compare_hash_target(zero_hash, target_256) == 0);

  /* Non-zero hash must fail difficulty 256 */
  uint8_t almost_zero[32];
  memset(almost_zero, 0x00, 32);
  almost_zero[31] = 0x01;
  assert(compare_hash_target(almost_zero, target_256) == 1);

  /* Test 5: Verify target array evaluation directly with synthetic target */
  uint8_t custom_target[32];
  memset(custom_target, 0xFF, 32);
  assert(verify_pow_target(test_data, test_data_len, nonce, nonce_len, custom_target) == 1);

  memset(custom_target, 0x00, 32);
  assert(verify_pow_target(test_data, test_data_len, nonce, nonce_len, custom_target) == 0);

  /* Test 6: Null pointer safety in verify_pow */
  assert(verify_pow(NULL, 0, nonce, nonce_len, 4) == 0);
  assert(verify_pow(test_data, test_data_len, NULL, 0, 4) == 0);
  assert(verify_pow_target(NULL, 0, nonce, nonce_len, custom_target) == 0);
  assert(verify_pow_target(test_data, test_data_len, NULL, 0, custom_target) == 0);
  assert(verify_pow_target(test_data, test_data_len, nonce, nonce_len, NULL) == 0);

  printf("  -> Passed extreme difficulty PoW verification tests.\n");
}

/* ========================================================================= */
/* Test Suite 6: Mining Nonce Exploration with Boundary Difficulties         */
/* ========================================================================= */
static void test_mining_nonce_exploration(void) {
  printf("Running Test Suite 6: Mining Nonce Exploration...\n");

  const uint8_t payload[] = "Venue-Desk-Booking-Claim";
  const size_t payload_len = sizeof(payload) - 1;
  uint8_t mined_nonce[8];
  uint64_t iterations = 0;

  /* Mining with difficulty 0 should find a solution on the very first iteration */
  int result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                        0, 1000, &iterations);
  assert(result == 1);
  assert(iterations == 1);
  assert(verify_pow(payload, payload_len, mined_nonce, 8, 0) == 1);

  /* Mining with small difficulty 4 bits (half byte) should solve quickly */
  result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                    4, 100000, &iterations);
  assert(result == 1);
  assert(iterations > 0);
  assert(verify_pow(payload, payload_len, mined_nonce, 8, 4) == 1);

  /* Mining with difficulty 8 bits (1 full byte zero) should succeed */
  result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                    8, 100000, &iterations);
  assert(result == 1);
  assert(iterations > 0);
  assert(verify_pow(payload, payload_len, mined_nonce, 8, 8) == 1);

  /* Mining with invalid negative difficulty must abort immediately */
  result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                    -5, 1000, &iterations);
  assert(result == -1);

  /* Mining with invalid difficulty > 256 must abort immediately */
  result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                    300, 1000, &iterations);
  assert(result == -1);

  /* Mining with short nonce buffer (< 8 bytes) must return error */
  result = mine_pow(payload, payload_len, mined_nonce, 4,
                    4, 1000, &iterations);
  assert(result == -1);

  /* Mining exceeding max_iterations safely returns 0 without infinite loop */
  result = mine_pow(payload, payload_len, mined_nonce, sizeof(mined_nonce),
                    24, 10, &iterations);
  assert(result == 0); /* 10 iterations insufficient for 24 bits */
  assert(iterations == 10);

  printf("  -> Passed mining nonce exploration tests.\n");
}

/* ========================================================================= */
/* Test Suite 7: 32-Bit Shift Transition Boundary Invariant Suite            */
/* ========================================================================= */
static void test_shift_transition_invariants(void) {
  printf("Running Test Suite 7: 32-Bit Shift Transition Boundary Invariants...\n");
  uint8_t target_prev[32];
  uint8_t target_curr[32];

  /* Verify strict monotonic decreasing target property as difficulty increases:
   * Target(D) < Target(D-1) for all D from 1 to 256
   */
  compute_target_256(0, target_prev);

  for (int d = 1; d <= 256; d++) {
    int res = compute_target_256(d, target_curr);
    assert(res == 0);

    /* Target must strictly decrease: compare_hash_target(target_curr, target_prev) must be -1 */
    int cmp = compare_hash_target(target_curr, target_prev);
    assert(cmp == -1);

    memcpy(target_prev, target_curr, 32);
  }

  printf("  -> Passed monotonic target decreasing invariant across all 256 bits.\n");
}

/* ========================================================================= */
/* Main Test Runner                                                          */
/* ========================================================================= */
int main(void) {
  printf("================================================================\n");
  printf("Starting sha256_pow 256-bit Target Difficulty Test Harness (#5611)\n");
  printf("================================================================\n\n");

  test_difficulty_parameter_validation();
  test_target_array_computation();
  test_hash_target_comparison();
  test_count_leading_zero_bits();
  test_extreme_difficulty_verification();
  test_mining_nonce_exploration();
  test_shift_transition_invariants();

  printf("\n================================================================\n");
  printf("ALL 7 TEST SUITES PASSED: 256-bit target arithmetic fully verified!\n");
  printf("================================================================\n");

  return 0;
}
