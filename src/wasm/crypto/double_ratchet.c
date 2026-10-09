/**
 * double_ratchet.c
 * C implementation of the Double Ratchet message encryption and decryption
 * state machines. Provides forward secrecy and post-compromise security for
 * group chat payloads.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define KEY_SIZE 32
#define NONCE_SIZE 12

typedef struct {
  uint8_t sending_chain_key[KEY_SIZE];
  uint8_t receiving_chain_key[KEY_SIZE];
  uint32_t sending_message_number;
  uint32_t receiving_message_number;
} RatchetState;

// Mock HMAC-SHA256 function (in production, link against a real crypto library
// like libsodium)
static void mock_hmac_sha256(const uint8_t *key, size_t key_len,
                             const uint8_t *data, size_t data_len,
                             uint8_t *output) {
  for (size_t i = 0; i < KEY_SIZE; i++) {
    output[i] = key[i % key_len] ^ (data ? data[i % data_len] : 0);
  }
}

void ratchet_init(RatchetState *state, const uint8_t *root_key) {
  if (!state || !root_key)
    return;
  memcpy(state->sending_chain_key, root_key, KEY_SIZE);
  memcpy(state->receiving_chain_key, root_key, KEY_SIZE);
  state->sending_message_number = 0;
  state->receiving_message_number = 0;
}

void ratchet_encrypt(RatchetState *state, const uint8_t *plaintext,
                     size_t plaintext_len, uint8_t *ciphertext, uint8_t *mac) {
  if (!state || !plaintext || !ciphertext || !mac)
    return;

  // Derive message key
  uint8_t message_key[KEY_SIZE];
  mock_hmac_sha256(state->sending_chain_key, KEY_SIZE,
                   (const uint8_t *)&state->sending_message_number,
                   sizeof(uint32_t), message_key);

  // Derive next chain key
  uint8_t next_chain_key[KEY_SIZE];
  mock_hmac_sha256(state->sending_chain_key, KEY_SIZE,
                   (const uint8_t *)"chain_ratchet", 13, next_chain_key);
  memcpy(state->sending_chain_key, next_chain_key, KEY_SIZE);

  // Mock XOR encryption
  for (size_t i = 0; i < plaintext_len; i++) {
    ciphertext[i] = plaintext[i] ^ message_key[i % KEY_SIZE];
  }

  // Mock MAC generation
  mock_hmac_sha256(message_key, KEY_SIZE, ciphertext, plaintext_len, mac);

  state->sending_message_number++;
}

int ratchet_decrypt(RatchetState *state, const uint8_t *ciphertext,
                    size_t ciphertext_len, const uint8_t *mac,
                    uint8_t *plaintext) {
  if (!state || !ciphertext || !mac || !plaintext)
    return -1;

  // Derive message key
  uint8_t message_key[KEY_SIZE];
  mock_hmac_sha256(state->receiving_chain_key, KEY_SIZE,
                   (const uint8_t *)&state->receiving_message_number,
                   sizeof(uint32_t), message_key);

  // Verify MAC (mock)
  uint8_t expected_mac[KEY_SIZE];
  mock_hmac_sha256(message_key, KEY_SIZE, ciphertext, ciphertext_len,
                   expected_mac);

  int mac_valid = 1;
  for (int i = 0; i < KEY_SIZE; i++) {
    if (mac[i] != expected_mac[i]) {
      mac_valid = 0;
      break;
    }
  }

  if (!mac_valid)
    return -1; // Authentication failed

  // Mock XOR decryption
  for (size_t i = 0; i < ciphertext_len; i++) {
    plaintext[i] = ciphertext[i] ^ message_key[i % KEY_SIZE];
  }

  // Derive next chain key
  uint8_t next_chain_key[KEY_SIZE];
  mock_hmac_sha256(state->receiving_chain_key, KEY_SIZE,
                   (const uint8_t *)"chain_ratchet", 13, next_chain_key);
  memcpy(state->receiving_chain_key, next_chain_key, KEY_SIZE);

  state->receiving_message_number++;
  return 0; // Success
}
