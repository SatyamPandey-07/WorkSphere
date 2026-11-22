/**
 * Unit & Integration tests for WebRTC Insertable Streams (SFrame) Audio Frame Encryption Engine.
 */

import {
  isInsertableStreamsSupported,
  serializeFrameHeader,
  parseFrameHeader,
  buildFrameNonce,
  ReplayFilter,
  generateEcdhKeyPair,
  exportPublicKeyRaw,
  importRemotePublicKey,
  deriveSessionKeys,
  encryptAudioFramePayload,
  decryptAudioFramePayload,
  InsertableStreamsEncryptionEngine,
  FRAME_HEADER_LENGTH,
  FRAME_MAGIC_BYTE,
  FRAME_VERSION_1,
  RTCEncodedAudioFrameLike,
  MAX_SAFE_COUNTER,
} from "../../lib/webrtc/insertableStreams";
import { MeshConnection } from "../../lib/webrtc/meshConnection";

// Helper to create dummy audio payload
function createDummyAudioPayload(size: number = 160): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (i * 7 + 13) & 0xff;
  }
  return buf;
}

describe("WebRTC Insertable Streams (SFrame) E2EE Audio Encryption", () => {
  describe("A. Frame Header & Nonce Construction", () => {
    it("serializes and parses a valid frame header correctly", () => {
      const epoch = 3;
      const counter = 123456789;
      const header = serializeFrameHeader(epoch, counter);

      expect(header.length).toBe(FRAME_HEADER_LENGTH);
      expect(header[0]).toBe(FRAME_MAGIC_BYTE);
      expect(header[1]).toBe(FRAME_VERSION_1);
      expect(header[2]).toBe(epoch);
      expect(header[3]).toBe(0);

      const parsed = parseFrameHeader(header, epoch);
      expect(parsed.version).toBe(FRAME_VERSION_1);
      expect(parsed.keyEpoch).toBe(epoch);
      expect(parsed.frameCounter).toBe(counter);
    });

    it("rejects invalid magic byte or version", () => {
      const header = serializeFrameHeader(1, 100);
      header[0] = 0x99; // Corrupt magic byte
      expect(() => parseFrameHeader(header)).toThrow(/Invalid frame magic byte/);

      header[0] = FRAME_MAGIC_BYTE;
      header[1] = 0x02; // Corrupt version
      expect(() => parseFrameHeader(header)).toThrow(/Unsupported frame version/);
    });

    it("rejects epoch mismatch when expectedEpoch is specified", () => {
      const header = serializeFrameHeader(1, 100);
      expect(() => parseFrameHeader(header, 2)).toThrow(/Frame key epoch mismatch/);
    });

    it("throws when serializing out-of-range counter or epoch", () => {
      expect(() => serializeFrameHeader(256, 100)).toThrow(/out of 8-bit bounds/);
      expect(() => serializeFrameHeader(-1, 100)).toThrow(/out of 8-bit bounds/);
      expect(() => serializeFrameHeader(1, -1)).toThrow(/out of safe 48-bit bounds/);
      expect(() => serializeFrameHeader(1, MAX_SAFE_COUNTER + 1)).toThrow(/out of safe 48-bit bounds/);
    });

    it("builds unique 96-bit nonces for distinct frame counters", () => {
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const nonce1 = buildFrameNonce(salt, 1);
      const nonce2 = buildFrameNonce(salt, 2);
      const nonce3 = buildFrameNonce(salt, 0x100000000); // 33rd bit set

      expect(nonce1).not.toEqual(nonce2);
      expect(nonce1).not.toEqual(nonce3);
      expect(nonce2).not.toEqual(nonce3);
      expect(nonce1.length).toBe(12);
    });
  });

  describe("B. Replay Protection Filter", () => {
    let filter: ReplayFilter;

    beforeEach(() => {
      filter = new ReplayFilter(64);
    });

    it("accepts sequential in-order frames", () => {
      expect(filter.checkAndAccept(0)).toBe(true);
      expect(filter.checkAndAccept(1)).toBe(true);
      expect(filter.checkAndAccept(2)).toBe(true);
      expect(filter.getMaxSeen()).toBe(2);
    });

    it("rejects duplicate frames", () => {
      expect(filter.checkAndAccept(10)).toBe(true);
      expect(filter.checkAndAccept(10)).toBe(false);
    });

    it("accepts out-of-order frames within the window", () => {
      expect(filter.checkAndAccept(10)).toBe(true);
      expect(filter.checkAndAccept(15)).toBe(true);
      expect(filter.checkAndAccept(12)).toBe(true); // within window [15 - 64 + 1, 15]
      expect(filter.checkAndAccept(11)).toBe(true);
      expect(filter.checkAndAccept(12)).toBe(false); // duplicate of previously accepted out-of-order
    });

    it("rejects stale frames outside the window", () => {
      expect(filter.checkAndAccept(100)).toBe(true);
      // Window is 64, so cutoff is 100 - 64 = 36. Counters <= 36 are rejected
      expect(filter.checkAndAccept(36)).toBe(false);
      expect(filter.checkAndAccept(30)).toBe(false);
      expect(filter.checkAndAccept(37)).toBe(true); // >= 37 is accepted
    });

    it("resets filter state properly", () => {
      expect(filter.checkAndAccept(50)).toBe(true);
      filter.reset();
      expect(filter.getMaxSeen()).toBe(-1);
      expect(filter.checkAndAccept(20)).toBe(true);
    });
  });

  describe("C. ECDH Key Agreement & HKDF Derivation", () => {
    it("generates valid P-256 keypairs and exports raw public keys (65 bytes)", async () => {
      const keyPair = await generateEcdhKeyPair();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();

      const rawPublic = await exportPublicKeyRaw(keyPair.publicKey);
      expect(rawPublic.length).toBe(65);
      expect(rawPublic[0]).toBe(0x04); // Uncompressed point
    });

    it("rejects malformed raw public keys", async () => {
      const invalidShort = new Uint8Array(64);
      await expect(importRemotePublicKey(invalidShort)).rejects.toThrow(/Invalid ECDH P-256 public key/);

      const invalidPrefix = new Uint8Array(65);
      invalidPrefix[0] = 0x02;
      await expect(importRemotePublicKey(invalidPrefix)).rejects.toThrow(/Invalid ECDH P-256 public key/);
    });

    it("derives complementary directional keys for Alice and Bob", async () => {
      const aliceKeys = await generateEcdhKeyPair();
      const bobKeys = await generateEcdhKeyPair();

      const aliceRawPub = await exportPublicKeyRaw(aliceKeys.publicKey);
      const bobRawPub = await exportPublicKeyRaw(bobKeys.publicKey);

      const aliceRemoteKey = await importRemotePublicKey(bobRawPub);
      const bobRemoteKey = await importRemotePublicKey(aliceRawPub);

      const aliceContext = {
        localPeerId: "peer-alice",
        remotePeerId: "peer-bob",
        sessionId: "session-123",
      };
      const bobContext = {
        localPeerId: "peer-bob",
        remotePeerId: "peer-alice",
        sessionId: "session-123",
      };

      const aliceDerived = await deriveSessionKeys(aliceKeys.privateKey, aliceRemoteKey, aliceContext, 0);
      const bobDerived = await deriveSessionKeys(bobKeys.privateKey, bobRemoteKey, bobContext, 0);

      // Directional check: Alice's send key/salt must encrypt what Bob's receive key/salt decrypts
      const payload = createDummyAudioPayload();
      const encryptedByAlice = await encryptAudioFramePayload(
        payload,
        aliceDerived.sendKey,
        aliceDerived.sendSalt,
        0,
        1
      );

      const bobReplay = new ReplayFilter();
      const decryptedByBob = await decryptAudioFramePayload(
        encryptedByAlice,
        bobDerived.receiveKey,
        bobDerived.receiveSalt,
        0,
        bobReplay
      );

      expect(new Uint8Array(decryptedByBob.decryptedPayload)).toEqual(payload);

      // And reverse direction: Bob send -> Alice receive
      const encryptedByBob = await encryptAudioFramePayload(
        payload,
        bobDerived.sendKey,
        bobDerived.sendSalt,
        0,
        1
      );

      const aliceReplay = new ReplayFilter();
      const decryptedByAlice = await decryptAudioFramePayload(
        encryptedByBob,
        aliceDerived.receiveKey,
        aliceDerived.receiveSalt,
        0,
        aliceReplay
      );

      expect(new Uint8Array(decryptedByAlice.decryptedPayload)).toEqual(payload);
    });

    it("rejects identical local and remote peer IDs or missing context", async () => {
      const keys = await generateEcdhKeyPair();
      const dummyRemote = await importRemotePublicKey(await exportPublicKeyRaw(keys.publicKey));

      await expect(
        deriveSessionKeys(keys.privateKey, dummyRemote, {
          localPeerId: "peer-a",
          remotePeerId: "peer-a",
          sessionId: "session-1",
        })
      ).rejects.toThrow(/must be distinct/);

      await expect(
        deriveSessionKeys(keys.privateKey, dummyRemote, {
          localPeerId: "",
          remotePeerId: "peer-b",
          sessionId: "session-1",
        })
      ).rejects.toThrow(/Missing required peer identity context/);
    });
  });

  describe("D. AES-GCM Audio Frame Payload Encryption & Decryption", () => {
    let aliceKey: CryptoKey;
    let bobKey: CryptoKey;
    let salt: Uint8Array;

    beforeAll(async () => {
      const subtle = globalThis.crypto.subtle;
      const rawKey = new Uint8Array(32);
      globalThis.crypto.getRandomValues(rawKey);

      aliceKey = await subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
      bobKey = await subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
      salt = new Uint8Array(12);
      globalThis.crypto.getRandomValues(salt);
    });

    it("encrypts and decrypts audio payload successfully", async () => {
      const plaintext = createDummyAudioPayload(200);
      const encrypted = await encryptAudioFramePayload(plaintext, aliceKey, salt, 0, 42);

      // Ciphertext must be larger due to 10-byte header and 16-byte tag
      expect(encrypted.length).toBe(plaintext.length + FRAME_HEADER_LENGTH + 16);

      // Plaintext must not appear in encrypted payload
      expect(encrypted.slice(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + plaintext.length)).not.toEqual(plaintext);

      const replayFilter = new ReplayFilter();
      const { decryptedPayload, header } = await decryptAudioFramePayload(
        encrypted,
        bobKey,
        salt,
        0,
        replayFilter
      );

      expect(header.frameCounter).toBe(42);
      expect(header.keyEpoch).toBe(0);
      expect(new Uint8Array(decryptedPayload)).toEqual(plaintext);
    });

    it("rejects truncated frames", async () => {
      const replayFilter = new ReplayFilter();
      const tooShort = new Uint8Array(15); // less than 26 bytes (10 header + 16 tag)
      await expect(
        decryptAudioFramePayload(tooShort, bobKey, salt, 0, replayFilter)
      ).rejects.toThrow(/truncated/);
    });

    it("rejects tampered ciphertext or modified header AAD", async () => {
      const plaintext = createDummyAudioPayload();
      const encrypted = await encryptAudioFramePayload(plaintext, aliceKey, salt, 0, 1);

      // Tamper with audio ciphertext payload
      const tamperedCiphertext = new Uint8Array(encrypted);
      tamperedCiphertext[FRAME_HEADER_LENGTH + 5] ^= 0xff;

      const replayFilter1 = new ReplayFilter();
      await expect(
        decryptAudioFramePayload(tamperedCiphertext, bobKey, salt, 0, replayFilter1)
      ).rejects.toThrow(/Frame authentication or decryption failed/);

      // Tamper with header AAD (e.g. modify reserved byte)
      const tamperedHeader = new Uint8Array(encrypted);
      tamperedHeader[3] ^= 0x01;

      const replayFilter2 = new ReplayFilter();
      await expect(
        decryptAudioFramePayload(tamperedHeader, bobKey, salt, 0, replayFilter2)
      ).rejects.toThrow(/Frame authentication or decryption failed/);
    });

    it("rejects replayed frames via replay filter", async () => {
      const plaintext = createDummyAudioPayload();
      const encrypted = await encryptAudioFramePayload(plaintext, aliceKey, salt, 0, 5);

      const replayFilter = new ReplayFilter();
      await decryptAudioFramePayload(encrypted, bobKey, salt, 0, replayFilter);

      // Replaying the exact same encrypted frame
      await expect(
        decryptAudioFramePayload(encrypted, bobKey, salt, 0, replayFilter)
      ).rejects.toThrow(/Replay protection violation/);
    });
  });

  describe("E. TransformStream Sender & Receiver Processing", () => {
    it("pipes audio frames through sender and receiver transforms end-to-end", async () => {
      const aliceEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: "alice",
        remotePeerId: "bob",
        sessionId: "call-1",
      });

      const bobEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: "bob",
        remotePeerId: "alice",
        sessionId: "call-1",
      });

      const alicePub = await aliceEngine.initializeLocalKey();
      const bobPub = await bobEngine.initializeLocalKey();

      await aliceEngine.setRemotePublicKey(bobPub, 0);
      await bobEngine.setRemotePublicKey(alicePub, 0);

      const senderTransform = aliceEngine.createSenderTransform();
      const receiverTransform = bobEngine.createReceiverTransform();

      const originalPayload = createDummyAudioPayload(320);
      const mockFrame: RTCEncodedAudioFrameLike = {
        data: originalPayload.buffer.slice(
          originalPayload.byteOffset,
          originalPayload.byteOffset + originalPayload.byteLength
        ),
        timestamp: 1000,
        type: "key",
      };

      // Pipe mockFrame through senderTransform
      const senderWriter = senderTransform.writable.getWriter();
      const senderReader = senderTransform.readable.getReader();

      const writePromise = senderWriter.write(mockFrame);
      const encryptedFrameResult = await senderReader.read();
      await writePromise;
      expect(encryptedFrameResult.done).toBe(false);

      const encryptedFrame = encryptedFrameResult.value!;
      expect(encryptedFrame.data.byteLength).toBe(originalPayload.byteLength + FRAME_HEADER_LENGTH + 16);
      expect(new Uint8Array(encryptedFrame.data)).not.toEqual(originalPayload);

      // Pipe encryptedFrame through receiverTransform
      const receiverWriter = receiverTransform.writable.getWriter();
      const receiverReader = receiverTransform.readable.getReader();

      const rWritePromise = receiverWriter.write(encryptedFrame);
      const decryptedFrameResult = await receiverReader.read();
      await rWritePromise;
      expect(decryptedFrameResult.done).toBe(false);

      const decryptedFrame = decryptedFrameResult.value!;
      expect(new Uint8Array(decryptedFrame.data)).toEqual(originalPayload);
      expect(decryptedFrame.timestamp).toBe(1000);

      aliceEngine.destroy();
      bobEngine.destroy();
    });

    it("drops frames if keys are not established to prevent plaintext transmission", async () => {
      const onError = jest.fn();
      const unkeyedEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: "alice",
        remotePeerId: "bob",
        sessionId: "call-1",
        onError,
      });

      const transform = unkeyedEngine.createSenderTransform();
      const writer = transform.writable.getWriter();
      const reader = transform.readable.getReader();

      const frame: RTCEncodedAudioFrameLike = {
        data: new Uint8Array([1, 2, 3]).buffer,
        timestamp: 10,
      };

      const writePromise = writer.write(frame);
      const readPromise = reader.read();
      await writePromise;
      await writer.close();

      const readResult = await readPromise;
      expect(readResult.done).toBe(true); // No frame enqueued
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Dropping frame to prevent plaintext transmission"),
        })
      );

      unkeyedEngine.destroy();
    });
  });

  describe("F. Capability Detection and MeshConnection Integration", () => {
    it("reports capability detection structure", () => {
      const caps = isInsertableStreamsSupported();
      expect(caps).toHaveProperty("supported");
      expect(caps).toHaveProperty("senderTransformSupported");
      expect(caps).toHaveProperty("receiverTransformSupported");
      expect(caps).toHaveProperty("transformStreamSupported");
      expect(caps).toHaveProperty("webCryptoSupported");
    });

    it("refuses to downgrade silently if E2EE is enabled but Insertable Streams are unsupported", () => {
      // In Node environment, RTCRtpSender.prototype.createEncodedStreams is undefined
      expect(() => {
        new MeshConnection({
          e2ee: {
            enabled: true,
            localPeerId: "alice",
            remotePeerId: "bob",
            sessionId: "session-1",
          },
        });
      }).toThrow(/WebRTC Insertable Streams are not supported/);
    });

    it("instantiates standard MeshConnection cleanly when E2EE is not enabled", () => {
      // Mock global RTCPeerConnection for testing MeshConnection in Node
      const originalRTC = (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
      class MockPC {
        public remoteDescription = null;
        public addTrack = jest.fn();
        public close = jest.fn();
        public setRemoteDescription = jest.fn();
        public addIceCandidate = jest.fn();
      }
      (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = MockPC;

      try {
        const mesh = new MeshConnection();
        expect(mesh.getEncryptionEngine()).toBeNull();
        expect(mesh.getPendingCandidatesCount()).toBe(0);
        mesh.close();
      } finally {
        (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = originalRTC;
      }
    });

    it("handles E2EE integration lifecycle when Insertable Streams are supported", async () => {
      // Mock WebRTC environment with createEncodedStreams support
      const originalRTC = (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
      const originalSender = (globalThis as unknown as { RTCRtpSender?: unknown }).RTCRtpSender;
      const originalReceiver = (globalThis as unknown as { RTCRtpReceiver?: unknown }).RTCRtpReceiver;

      class MockSender {
        public track = { kind: "audio" };
        public createEncodedStreams = jest.fn(() => {
          const ts = new TransformStream();
          return { readable: ts.readable, writable: ts.writable };
        });
        public replaceTrack = jest.fn();
      }
      MockSender.prototype.createEncodedStreams = jest.fn(() => {
        const ts = new TransformStream();
        return { readable: ts.readable, writable: ts.writable };
      });

      class MockReceiver {
        public track = { kind: "audio" };
        public createEncodedStreams = jest.fn(() => {
          const ts = new TransformStream();
          return { readable: ts.readable, writable: ts.writable };
        });
      }
      MockReceiver.prototype.createEncodedStreams = jest.fn(() => {
        const ts = new TransformStream();
        return { readable: ts.readable, writable: ts.writable };
      });

      class MockPC {
        public remoteDescription = null;
        public addTrack = jest.fn(() => new MockSender());
        public getReceivers = jest.fn(() => [new MockReceiver()]);
        public addEventListener = jest.fn();
        public close = jest.fn();
        public setRemoteDescription = jest.fn().mockResolvedValue(undefined);
      }

      (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = MockPC;
      (globalThis as unknown as { RTCRtpSender: unknown }).RTCRtpSender = MockSender;
      (globalThis as unknown as { RTCRtpReceiver: unknown }).RTCRtpReceiver = MockReceiver;

      try {
        const mesh = new MeshConnection({
          e2ee: {
            enabled: true,
            localPeerId: "alice",
            remotePeerId: "bob",
            sessionId: "call-99",
          },
        });

        const engine = mesh.getEncryptionEngine();
        expect(engine).not.toBeNull();

        const dummyTrack = { kind: "audio" } as MediaStreamTrack;
        const sender = mesh.addTrack(dummyTrack);

        // Check sender transform attachment
        expect(sender.createEncodedStreams).toHaveBeenCalledTimes(1);

        // Check setRemoteDescription attaches receiver transforms
        await mesh.setRemoteDescription({ type: "offer", sdp: "dummy" });

        // Check cleanup on close
        mesh.close();
        expect(mesh.getEncryptionEngine()).toBeNull();
      } finally {
        (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = originalRTC;
        (globalThis as unknown as { RTCRtpSender: unknown }).RTCRtpSender = originalSender;
        (globalThis as unknown as { RTCRtpReceiver: unknown }).RTCRtpReceiver = originalReceiver;
      }
    });
  });

  describe("G. Key Rotation & Counter Progression", () => {
    it("handles key rotation across epochs seamlessly", async () => {
      const aliceEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: "alice",
        remotePeerId: "bob",
        sessionId: "session-rot",
      });
      const bobEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: "bob",
        remotePeerId: "alice",
        sessionId: "session-rot",
      });

      // Epoch 0
      const aPub0 = await aliceEngine.initializeLocalKey();
      const bPub0 = await bobEngine.initializeLocalKey();
      await aliceEngine.setRemotePublicKey(bPub0, 0);
      await bobEngine.setRemotePublicKey(aPub0, 0);
      expect(aliceEngine.getEpoch()).toBe(0);

      // Rotate to Epoch 1
      const aPub1 = await aliceEngine.initializeLocalKey();
      const bPub1 = await bobEngine.initializeLocalKey();
      await aliceEngine.setRemotePublicKey(bPub1, 1);
      await bobEngine.setRemotePublicKey(aPub1, 1);
      expect(aliceEngine.getEpoch()).toBe(1);

      // Verify traffic encrypts and decrypts on epoch 1
      const payload = createDummyAudioPayload(80);
      const senderTransform = aliceEngine.createSenderTransform();
      const receiverTransform = bobEngine.createReceiverTransform();

      const sWriter = senderTransform.writable.getWriter();
      const sReader = senderTransform.readable.getReader();
      const rWriter = receiverTransform.writable.getWriter();
      const rReader = receiverTransform.readable.getReader();

      const sWritePromise = sWriter.write({ data: payload.buffer.slice(0), timestamp: 50 });
      const enc = await sReader.read();
      await sWritePromise;

      const rWritePromise = rWriter.write(enc.value!);
      const dec = await rReader.read();
      await rWritePromise;

      expect(new Uint8Array(dec.value!.data)).toEqual(payload);

      aliceEngine.destroy();
      bobEngine.destroy();
    });
  });
});
