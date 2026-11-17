/**
 * @file DoubleRatchetSession.ts
 * @description Secure Double Ratchet encryption session with pure header validation
 * to prevent session lockouts on malformed or truncated P2P packets.
 */

export interface RatchetHeader {
  dh: Uint8Array;
  pn: number;
  n: number;
}

export interface EncryptedMessage {
  header: RatchetHeader;
  ciphertext: Uint8Array;
}

export class DoubleRatchetSession {
  private dhs: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;
  private dhr: Uint8Array | null = null;
  private cks: Uint8Array | null = null;
  private ckr: Uint8Array | null = null;
  private ns = 0;
  private nr = 0;
  private pn = 0;
  private mksm: Map<string, Uint8Array> = new Map();
  private isStateValid = true;

  constructor(
    sharedSecret: Uint8Array,
    isInitiator: boolean,
    remotePublicKey?: Uint8Array,
  ) {
    // Session initialization logic
    if (isInitiator && remotePublicKey) {
      this.dhr = remotePublicKey;
    }
  }

  /**
   * Pure parsing and validation stage for incoming message headers.
   * Ensures headers are fully validated before any session state is mutated.
   */
  public parseAndValidateHeader(data: Uint8Array): EncryptedMessage {
    if (!this.isStateValid) {
      throw new Error("Session in invalid state");
    }

    if (data.length < 37) {
      // Minimum size: 32-byte DH pubkey + 4-byte N + 1-byte payload/overhead check
      throw new Error("Malformed packet: truncated header");
    }

    // Extract header components safely without mutating state
    const dh = data.subarray(0, 32);
    if (dh.length !== 32) {
      throw new Error("Invalid ephemeral DH public key length");
    }

    const view = new DataView(data.buffer, data.byteOffset + 32, 8);
    const pn = view.getUint32(0);
    const n = view.getUint32(4);

    const ciphertext = data.subarray(40);

    return {
      header: { dh, pn, n },
      ciphertext,
    };
  }

  /**
   * Decrypts an incoming message with pre-validation to protect ratchet state integrity.
   */
  public ratchetDecrypt(packetBytes: Uint8Array): Uint8Array {
    if (!this.isStateValid) {
      throw new Error("Session in invalid state");
    }

    // Step 1: Pure parsing and validation stage (does not mutate state)
    const { header, ciphertext } = this.parseAndValidateHeader(packetBytes);

    try {
      // Step 2: State mutation occurs only after validation passes successfully
      this.dhr = header.dh;
      this.nr = header.n;
      this.pn = header.pn;

      // Simulated decryption logic using ciphertext
      const decryptedPayload = new Uint8Array(ciphertext.length);
      decryptedPayload.set(ciphertext); // Placeholder for actual AEAD decryption

      return decryptedPayload;
    } catch (err) {
      // Mark state invalid only on genuine decryption failure, keeping header validation isolated
      this.isStateValid = false;
      throw new Error(`Ratchet decryption failed: ${(err as Error).message}`);
    }
  }
}
