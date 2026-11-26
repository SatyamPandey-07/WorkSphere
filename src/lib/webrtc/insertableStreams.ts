/**
 * WebRTC Insertable Streams (SFrame-inspired) Audio Frame Encryption Engine.
 *
 * Provides typed, modular End-to-End Encryption (E2EE) for WebRTC audio media
 * using WebRTC Insertable Streams (RTCRtpSender.createEncodedStreams / RTCRtpReceiver.createEncodedStreams),
 * TransformStreams, ephemeral ECDH key agreement, HKDF directional key derivation,
 * and AES-GCM frame payload encryption with authenticated metadata (AAD) and replay protection.
 */

// Global WebCrypto helper to ensure cross-environment compatibility (Browser & Node.js >= 18)
function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  const nodeCrypto = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto;
  if (nodeCrypto?.subtle) {
    return nodeCrypto.subtle;
  }
  throw new Error("Web Crypto (crypto.subtle) is not available in the current environment");
}

/**
 * Encoded Audio Frame interface matching RTCEncodedAudioFrame from WebRTC Insertable Streams spec.
 */
export interface RTCEncodedAudioFrameLike {
  data: ArrayBuffer;
  timestamp: number;
  type?: string;
  getMetadata?: () => Record<string, unknown>;
}

export interface EncodedStreamsLike {
  readable: ReadableStream<RTCEncodedAudioFrameLike>;
  writable: WritableStream<RTCEncodedAudioFrameLike>;
}

/**
 * Capability detection result for WebRTC Insertable Streams.
 */
export interface InsertableStreamsCapabilities {
  supported: boolean;
  senderTransformSupported: boolean;
  receiverTransformSupported: boolean;
  transformStreamSupported: boolean;
  webCryptoSupported: boolean;
}

/**
 * Check if the current browser/runtime supports WebRTC Insertable Streams for audio.
 */
export function isInsertableStreamsSupported(): InsertableStreamsCapabilities {
  const transformStreamSupported = typeof TransformStream !== "undefined";
  const webCryptoSupported =
    typeof globalThis !== "undefined" &&
    !!globalThis.crypto &&
    typeof globalThis.crypto.subtle !== "undefined";

  // Check RTCRtpSender.prototype.createEncodedStreams
  let senderTransformSupported = false;
  let receiverTransformSupported = false;

  if (typeof RTCRtpSender !== "undefined" && RTCRtpSender.prototype) {
    senderTransformSupported =
      typeof (RTCRtpSender.prototype as unknown as { createEncodedStreams?: unknown }).createEncodedStreams === "function";
  }

  if (typeof RTCRtpReceiver !== "undefined" && RTCRtpReceiver.prototype) {
    receiverTransformSupported =
      typeof (RTCRtpReceiver.prototype as unknown as { createEncodedStreams?: unknown }).createEncodedStreams === "function";
  }

  const supported =
    transformStreamSupported &&
    webCryptoSupported &&
    senderTransformSupported &&
    receiverTransformSupported;

  return {
    supported,
    senderTransformSupported,
    receiverTransformSupported,
    transformStreamSupported,
    webCryptoSupported,
  };
}

/**
 * Frame Header Specification:
 * Length: 10 bytes
 * Offset 0: Magic Byte 0x53 ('S')
 * Offset 1: Version Byte 0x01
 * Offset 2: Key Epoch (uint8, 0-255)
 * Offset 3: Reserved (0x00)
 * Offset 4..9: 48-bit Monotonic Frame Counter (Big-Endian, up to 2^48 - 1)
 */
export const FRAME_HEADER_LENGTH = 10;
export const FRAME_MAGIC_BYTE = 0x53; // 'S' for SFrame-like
export const FRAME_VERSION_1 = 0x01;
export const AES_GCM_TAG_LENGTH_BYTES = 16;
export const AES_GCM_NONCE_LENGTH_BYTES = 12; // 96 bits

// Replay window size (e.g. 128 frames)
export const DEFAULT_REPLAY_WINDOW_SIZE = 128;
// Counter exhaustion threshold before rotation is required (2^48 - 1, or safer practical threshold)
export const MAX_SAFE_COUNTER = 0xffffffffffff; // 48-bit max: 281,474,976,710,655

export interface ParsedFrameHeader {
  version: number;
  keyEpoch: number;
  frameCounter: number;
  rawHeader: Uint8Array;
}

/**
 * Serializes a 10-byte frame header into a Uint8Array.
 */
export function serializeFrameHeader(
  keyEpoch: number,
  frameCounter: number
): Uint8Array {
  if (frameCounter < 0 || frameCounter > MAX_SAFE_COUNTER) {
    throw new RangeError(
      `Frame counter ${frameCounter} is out of safe 48-bit bounds [0, ${MAX_SAFE_COUNTER}]`
    );
  }
  if (keyEpoch < 0 || keyEpoch > 255) {
    throw new RangeError(`Key epoch ${keyEpoch} is out of 8-bit bounds [0, 255]`);
  }

  const header = new Uint8Array(FRAME_HEADER_LENGTH);
  header[0] = FRAME_MAGIC_BYTE;
  header[1] = FRAME_VERSION_1;
  header[2] = keyEpoch & 0xff;
  header[3] = 0x00; // Reserved

  // Write 48-bit big-endian integer into bytes 4..9
  const high16 = Math.floor(frameCounter / 0x100000000); // upper 16 bits
  const low32 = frameCounter >>> 0; // lower 32 bits

  header[4] = (high16 >>> 8) & 0xff;
  header[5] = high16 & 0xff;
  header[6] = (low32 >>> 24) & 0xff;
  header[7] = (low32 >>> 16) & 0xff;
  header[8] = (low32 >>> 8) & 0xff;
  header[9] = low32 & 0xff;

  return header;
}

/**
 * Deserializes and validates a 10-byte frame header from a buffer.
 */
export function parseFrameHeader(
  buffer: ArrayBuffer | Uint8Array,
  expectedEpoch?: number
): ParsedFrameHeader {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < FRAME_HEADER_LENGTH) {
    throw new Error(
      `Frame buffer too short (${bytes.length} bytes); header requires ${FRAME_HEADER_LENGTH} bytes`
    );
  }

  if (bytes[0] !== FRAME_MAGIC_BYTE) {
    throw new Error(`Invalid frame magic byte: 0x${bytes[0].toString(16)} (expected 0x53)`);
  }

  if (bytes[1] !== FRAME_VERSION_1) {
    throw new Error(`Unsupported frame version: ${bytes[1]} (expected ${FRAME_VERSION_1})`);
  }

  const keyEpoch = bytes[2];
  if (expectedEpoch !== undefined && keyEpoch !== expectedEpoch) {
    throw new Error(
      `Frame key epoch mismatch: frame specifies epoch ${keyEpoch}, expected ${expectedEpoch}`
    );
  }

  const high16 = (bytes[4] << 8) | bytes[5];
  const low32 =
    ((bytes[6] << 24) >>> 0) | (bytes[7] << 16) | (bytes[8] << 8) | bytes[9];
  const frameCounter = high16 * 0x100000000 + low32;

  const rawHeader = bytes.slice(0, FRAME_HEADER_LENGTH);

  return {
    version: bytes[1],
    keyEpoch,
    frameCounter,
    rawHeader,
  };
}

/**
 * Builds a 96-bit (12-byte) AES-GCM Nonce:
 * XOR baseSalt (12 bytes) with 48-bit frameCounter shifted into the least significant 6 bytes.
 * This guarantees a strictly unique nonce for each frame under the same session key.
 */
export function buildFrameNonce(baseSalt: Uint8Array, frameCounter: number): Uint8Array {
  if (baseSalt.length !== AES_GCM_NONCE_LENGTH_BYTES) {
    throw new Error(`Base salt must be exactly ${AES_GCM_NONCE_LENGTH_BYTES} bytes`);
  }

  const nonce = new Uint8Array(baseSalt); // copy
  // 48-bit counter into the last 6 bytes (indices 6..11)
  const high16 = Math.floor(frameCounter / 0x100000000);
  const low32 = frameCounter >>> 0;

  nonce[6] ^= (high16 >>> 8) & 0xff;
  nonce[7] ^= high16 & 0xff;
  nonce[8] ^= (low32 >>> 24) & 0xff;
  nonce[9] ^= (low32 >>> 16) & 0xff;
  nonce[10] ^= (low32 >>> 8) & 0xff;
  nonce[11] ^= low32 & 0xff;

  return nonce;
}

/**
 * Sliding Window Replay Protection.
 * Tracks the highest seen frame counter and maintains a bitmask of seen counters
 * within a window size of W (default 128).
 */
export class ReplayFilter {
  private windowSize: number;
  private maxSeenCounter: number = -1;
  // Use a BigInt or Set for seen counter tracking within [maxSeenCounter - windowSize + 1, maxSeenCounter]
  private seenCounters: Set<number> = new Set();

  constructor(windowSize: number = DEFAULT_REPLAY_WINDOW_SIZE) {
    if (windowSize <= 0) {
      throw new RangeError("Replay window size must be positive");
    }
    this.windowSize = windowSize;
  }

  /**
   * Checks whether the counter is valid (not replayed or stale) and marks it seen if valid.
   * Returns true if accepted, false if replayed or older than the replay window.
   */
  public checkAndAccept(counter: number): boolean {
    if (counter < 0 || counter > MAX_SAFE_COUNTER) {
      return false;
    }

    // First frame
    if (this.maxSeenCounter === -1) {
      this.maxSeenCounter = counter;
      this.seenCounters.add(counter);
      return true;
    }

    // Frame is newer than the highest seen counter
    if (counter > this.maxSeenCounter) {
      this.maxSeenCounter = counter;
      this.seenCounters.add(counter);
      // Evict counters outside window
      const cutoff = this.maxSeenCounter - this.windowSize;
      for (const seen of this.seenCounters) {
        if (seen <= cutoff) {
          this.seenCounters.delete(seen);
        }
      }
      return true;
    }

    // Frame is older than the replay window cutoff
    if (counter <= this.maxSeenCounter - this.windowSize) {
      return false; // Stale frame
    }

    // Frame is within window [maxSeenCounter - windowSize + 1, maxSeenCounter]
    if (this.seenCounters.has(counter)) {
      return false; // Replayed frame
    }

    // New frame arriving out of order within window
    this.seenCounters.add(counter);
    return true;
  }

  public reset(): void {
    this.maxSeenCounter = -1;
    this.seenCounters.clear();
  }

  public getMaxSeen(): number {
    return this.maxSeenCounter;
  }
}

/**
 * Key Material & Derivation Result
 */
export interface DerivedSessionKeys {
  sendKey: CryptoKey;
  receiveKey: CryptoKey;
  sendSalt: Uint8Array;
  receiveSalt: Uint8Array;
  epoch: number;
}

export interface PeerIdentityContext {
  localPeerId: string;
  remotePeerId: string;
  sessionId: string;
}

/**
 * Generates an ephemeral ECDH key pair on the P-256 (secp256r1) curve.
 */
export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  const subtle = getSubtleCrypto();
  return subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true, // extractable (so public key can be exported)
    ["deriveKey", "deriveBits"]
  );
}

/**
 * Exports a public key to raw uncompressed bytes (ANSI X9.63 / 65 bytes for P-256).
 */
export async function exportPublicKeyRaw(publicKey: CryptoKey): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const exported = await subtle.exportKey("raw", publicKey);
  return new Uint8Array(exported);
}

/**
 * Imports a remote peer's raw public key for ECDH key agreement.
 */
export async function importRemotePublicKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  if (rawBytes.length !== 65 || rawBytes[0] !== 0x04) {
    throw new Error(
      `Invalid ECDH P-256 public key length or format (length: ${rawBytes.length}, expected 65 bytes uncompressed starting with 0x04)`
    );
  }
  const subtle = getSubtleCrypto();
  return subtle.importKey(
    "raw",
    rawBytes as BufferSource,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false, // remote key does not need to be extractable
    []
  );
}

/**
 * Derives directional AES-GCM session keys and 96-bit base salts from shared ECDH secret using HKDF.
 *
 * Directional Key Separation:
 * Depending on peer ID ordering (localPeerId < remotePeerId or vice versa), directional keys
 * are assigned deterministically so Peer A's send key equals Peer B's receive key and vice versa.
 */
export async function deriveSessionKeys(
  localPrivateKey: CryptoKey,
  remotePublicKey: CryptoKey,
  context: PeerIdentityContext,
  epoch: number = 0
): Promise<DerivedSessionKeys> {
  if (!context.localPeerId || !context.remotePeerId || !context.sessionId) {
    throw new Error(
      "Missing required peer identity context (localPeerId, remotePeerId, sessionId)"
    );
  }
  if (context.localPeerId === context.remotePeerId) {
    throw new Error("Local and remote peer IDs must be distinct");
  }

  const subtle = getSubtleCrypto();

  // 1. Derive 256-bit shared secret bits from ECDH
  const sharedSecretBits = await subtle.deriveBits(
    {
      name: "ECDH",
      public: remotePublicKey,
    },
    localPrivateKey,
    256
  );

  // 2. Import shared secret bits as HKDF Master Key
  const hkdfKey = await subtle.importKey(
    "raw",
    sharedSecretBits,
    { name: "HKDF" },
    false,
    ["deriveKey", "deriveBits"]
  );

  // 3. Salt and Info binding
  // Canonical peer ordering: peer1 < peer2
  const isInitiator = context.localPeerId < context.remotePeerId;
  const peer1 = isInitiator ? context.localPeerId : context.remotePeerId;
  const peer2 = isInitiator ? context.remotePeerId : context.localPeerId;

  const textEncoder = new TextEncoder();
  const salt = textEncoder.encode(`WorkSphere-E2EE-v1:${context.sessionId}:${peer1}:${peer2}:epoch${epoch}`);

  // We derive 4 items using HKDF expand:
  // Key 1->2 (256 bits = 32 bytes)
  // Salt 1->2 (96 bits = 12 bytes)
  // Key 2->1 (256 bits = 32 bytes)
  // Salt 2->1 (96 bits = 12 bytes)
  // Total: 88 bytes derived bits
  const derivedBytesBuffer = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: textEncoder.encode("WorkSphere-InsertableStreams-SFrame-Keys"),
    },
    hkdfKey,
    88 * 8 // 704 bits
  );

  const derivedBytes = new Uint8Array(derivedBytesBuffer);

  const key1to2Bytes = derivedBytes.slice(0, 32);
  const salt1to2Bytes = derivedBytes.slice(32, 44);
  const key2to1Bytes = derivedBytes.slice(44, 76);
  const salt2to1Bytes = derivedBytes.slice(76, 88);

  const [sendKeyBytes, sendSalt, receiveKeyBytes, receiveSalt] = isInitiator
    ? [key1to2Bytes, salt1to2Bytes, key2to1Bytes, salt2to1Bytes]
    : [key2to1Bytes, salt2to1Bytes, key1to2Bytes, salt1to2Bytes];

  const sendKey = await subtle.importKey(
    "raw",
    sendKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const receiveKey = await subtle.importKey(
    "raw",
    receiveKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  return {
    sendKey,
    receiveKey,
    sendSalt,
    receiveSalt,
    epoch,
  };
}

/**
 * Encrypts an audio frame payload with AES-GCM and prepends the 10-byte authenticated header.
 */
export async function encryptAudioFramePayload(
  payload: ArrayBuffer | Uint8Array,
  key: CryptoKey,
  salt: Uint8Array,
  epoch: number,
  frameCounter: number
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const header = serializeFrameHeader(epoch, frameCounter);
  const nonce = buildFrameNonce(salt, frameCounter);

  const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

  const ciphertextBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce as BufferSource,
      additionalData: header as BufferSource,
      tagLength: 128, // 16 bytes tag appended
    },
    key,
    payloadBytes as BufferSource
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const totalLength = header.length + ciphertextBytes.length;
  const result = new Uint8Array(totalLength);
  result.set(header, 0);
  result.set(ciphertextBytes, header.length);

  return result;
}

/**
 * Decrypts an encrypted audio frame, validates the header and AAD tag, checks replay protection,
 * and returns the decrypted payload.
 */
export async function decryptAudioFramePayload(
  frameData: ArrayBuffer | Uint8Array,
  key: CryptoKey,
  salt: Uint8Array,
  expectedEpoch: number,
  replayFilter: ReplayFilter
): Promise<{ decryptedPayload: Uint8Array; header: ParsedFrameHeader }> {
  const subtle = getSubtleCrypto();
  const frameBytes = frameData instanceof Uint8Array ? frameData : new Uint8Array(frameData);

  if (frameBytes.length < FRAME_HEADER_LENGTH + AES_GCM_TAG_LENGTH_BYTES) {
    throw new Error(
      `Frame data truncated: length ${frameBytes.length} is less than header + tag (${FRAME_HEADER_LENGTH + AES_GCM_TAG_LENGTH_BYTES} bytes)`
    );
  }

  const header = parseFrameHeader(frameBytes, expectedEpoch);

  // Check replay protection before proceeding
  const accepted = replayFilter.checkAndAccept(header.frameCounter);
  if (!accepted) {
    throw new Error(
      `Replay protection violation: duplicate or stale frame counter ${header.frameCounter} (max seen: ${replayFilter.getMaxSeen()})`
    );
  }

  const nonce = buildFrameNonce(salt, header.frameCounter);
  const ciphertextBytes = frameBytes.slice(FRAME_HEADER_LENGTH);

  try {
    const decryptedBuffer = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: header.rawHeader as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertextBytes as BufferSource
    );

    return {
      decryptedPayload: new Uint8Array(decryptedBuffer),
      header,
    };
  } catch (err) {
    throw new Error(`Frame authentication or decryption failed: ${(err as Error).message}`);
  }
}

/**
 * Options for InsertableStreamsEncryptionEngine.
 */
export interface EncryptionEngineOptions {
  localPeerId: string;
  remotePeerId: string;
  sessionId: string;
  replayWindowSize?: number;
  onRotationRequired?: () => void;
  onError?: (err: Error) => void;
}

/**
 * InsertableStreamsEncryptionEngine
 * Encapsulates the entire lifecycle of audio frame encryption and decryption for a WebRTC peer connection.
 */
export class InsertableStreamsEncryptionEngine {
  private localKeyPair: CryptoKeyPair | null = null;
  private sessionKeys: DerivedSessionKeys | null = null;
  private replayFilter: ReplayFilter;
  private sendFrameCounter: number = 0;
  private options: EncryptionEngineOptions;
  private isDestroyed: boolean = false;

  constructor(options: EncryptionEngineOptions) {
    this.options = options;
    this.replayFilter = new ReplayFilter(options.replayWindowSize ?? DEFAULT_REPLAY_WINDOW_SIZE);
  }

  /**
   * Generates local ephemeral ECDH keypair and returns exported public key bytes.
   */
  public async initializeLocalKey(): Promise<Uint8Array> {
    this.localKeyPair = await generateEcdhKeyPair();
    return exportPublicKeyRaw(this.localKeyPair.publicKey);
  }

  /**
   * Sets the remote peer's public key, deriving directional session keys.
   */
  public async setRemotePublicKey(
    remotePublicKeyBytes: Uint8Array,
    epoch: number = 0
  ): Promise<void> {
    if (!this.localKeyPair) {
      throw new Error("Local ECDH keypair not initialized before setting remote key");
    }
    const remoteKey = await importRemotePublicKey(remotePublicKeyBytes);
    const context: PeerIdentityContext = {
      localPeerId: this.options.localPeerId,
      remotePeerId: this.options.remotePeerId,
      sessionId: this.options.sessionId,
    };

    this.sessionKeys = await deriveSessionKeys(
      this.localKeyPair.privateKey,
      remoteKey,
      context,
      epoch
    );
    this.sendFrameCounter = 0;
    this.replayFilter.reset();
  }

  /**
   * Rotates session keys with a new epoch.
   */
  public async rotateKey(
    newRemotePublicKeyBytes: Uint8Array,
    newEpoch: number
  ): Promise<Uint8Array> {
    const newLocalPublic = await this.initializeLocalKey();
    await this.setRemotePublicKey(newRemotePublicKeyBytes, newEpoch);
    return newLocalPublic;
  }

  /**
   * Gets current key epoch.
   */
  public getEpoch(): number {
    return this.sessionKeys ? this.sessionKeys.epoch : 0;
  }

  /**
   * Creates a TransformStream for RTCRtpSender to encrypt outgoing audio frames.
   */
  public createSenderTransform(): TransformStream<
    RTCEncodedAudioFrameLike,
    RTCEncodedAudioFrameLike
  > {
    return new TransformStream<RTCEncodedAudioFrameLike, RTCEncodedAudioFrameLike>({
      transform: async (frame, controller) => {
        if (this.isDestroyed) {
          return;
        }

        if (!this.sessionKeys) {
          const err = new Error(
            "Cannot encrypt outgoing audio frame: encryption keys not established. Dropping frame to prevent plaintext transmission."
          );
          if (this.options.onError) this.options.onError(err);
          // Never pass plaintext through an encryption-enabled sender
          return;
        }

        if (this.sendFrameCounter >= MAX_SAFE_COUNTER) {
          const err = new Error(
            "Send frame counter reached safe 48-bit limit. Key rotation required."
          );
          if (this.options.onRotationRequired) this.options.onRotationRequired();
          if (this.options.onError) this.options.onError(err);
          return;
        }

        const counter = this.sendFrameCounter++;
        try {
          const encryptedBytes = await encryptAudioFramePayload(
            frame.data,
            this.sessionKeys.sendKey,
            this.sessionKeys.sendSalt,
            this.sessionKeys.epoch,
            counter
          );

          // Update frame data with encrypted bytes
          frame.data = encryptedBytes.buffer.slice(
            encryptedBytes.byteOffset,
            encryptedBytes.byteOffset + encryptedBytes.byteLength
          ) as ArrayBuffer;
          controller.enqueue(frame);
        } catch (err) {
          if (this.options.onError) this.options.onError(err as Error);
          // Never enqueue plaintext on error
        }
      },
    });
  }

  /**
   * Creates a TransformStream for RTCRtpReceiver to decrypt incoming audio frames.
   */
  public createReceiverTransform(): TransformStream<
    RTCEncodedAudioFrameLike,
    RTCEncodedAudioFrameLike
  > {
    return new TransformStream<RTCEncodedAudioFrameLike, RTCEncodedAudioFrameLike>({
      transform: async (frame, controller) => {
        if (this.isDestroyed) {
          return;
        }

        if (!this.sessionKeys) {
          const err = new Error(
            "Cannot decrypt incoming audio frame: session keys not established. Dropping unauthenticated frame."
          );
          if (this.options.onError) this.options.onError(err);
          return;
        }

        try {
          const { decryptedPayload } = await decryptAudioFramePayload(
            frame.data,
            this.sessionKeys.receiveKey,
            this.sessionKeys.receiveSalt,
            this.sessionKeys.epoch,
            this.replayFilter
          );

          frame.data = decryptedPayload.buffer.slice(
            decryptedPayload.byteOffset,
            decryptedPayload.byteOffset + decryptedPayload.byteLength
          ) as ArrayBuffer;
          controller.enqueue(frame);
        } catch (err) {
          // Drop replayed, tampered, or corrupt frames silently or notify error
          if (this.options.onError) this.options.onError(err as Error);
        }
      },
    });
  }

  /**
   * Attaches sender transform to an RTCRtpSender.
   */
  public attachSender(sender: RTCRtpSender): void {
    const streamSender = sender as unknown as {
      createEncodedStreams?: () => EncodedStreamsLike;
    };
    if (typeof streamSender.createEncodedStreams !== "function") {
      throw new Error(
        "RTCRtpSender.createEncodedStreams() is not supported by this browser/runtime"
      );
    }

    const { readable, writable } = streamSender.createEncodedStreams();
    const transform = this.createSenderTransform();

    readable.pipeThrough(transform).pipeTo(writable).catch((err) => {
      if (!this.isDestroyed && this.options.onError) {
        this.options.onError(err as Error);
      }
    });
  }

  /**
   * Attaches receiver transform to an RTCRtpReceiver.
   */
  public attachReceiver(receiver: RTCRtpReceiver): void {
    const streamReceiver = receiver as unknown as {
      createEncodedStreams?: () => EncodedStreamsLike;
    };
    if (typeof streamReceiver.createEncodedStreams !== "function") {
      throw new Error(
        "RTCRtpReceiver.createEncodedStreams() is not supported by this browser/runtime"
      );
    }

    const { readable, writable } = streamReceiver.createEncodedStreams();
    const transform = this.createReceiverTransform();

    readable.pipeThrough(transform).pipeTo(writable).catch((err) => {
      if (!this.isDestroyed && this.options.onError) {
        this.options.onError(err as Error);
      }
    });
  }

  /**
   * Cleans up keys, filters, and stream references.
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.localKeyPair = null;
    this.sessionKeys = null;
    this.replayFilter.reset();
  }
}
