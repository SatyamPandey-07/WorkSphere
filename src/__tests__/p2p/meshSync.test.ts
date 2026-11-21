import { jest, describe, it, expect } from "@jest/globals";
import crypto from "crypto";
import { Buffer } from "buffer";
import {
  MeshSyncProtocol,
  SignedReviewAttestation,
  ReviewPayload,
  verifyECDSASignature,
} from "../../core/p2p/MeshSyncProtocol";
// Helper to sign review using ECDSA
async function createSignedReview(payload: ReviewPayload): Promise<SignedReviewAttestation> {
  const cryptoSubtle = crypto.webcrypto.subtle;
  const keyPair = await cryptoSubtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(payload));
  const sig = await cryptoSubtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    keyPair.privateKey,
    data
  );

  const publicKeyJwk = await cryptoSubtle.exportKey("jwk", keyPair.publicKey);

  return {
    payload,
    signature: Buffer.from(sig).toString("hex"),
    publicKey: JSON.stringify(publicKeyJwk),
  };
}

// Mock RTCDataChannel
function createMockChannelPair() {
  let ch1OnMessage: ((e: any) => void) | null = null;
  let ch2OnMessage: ((e: any) => void) | null = null;

  const ch1: any = {
    readyState: "open",
    send: jest.fn((msg) => {
      setTimeout(() => ch2OnMessage?.({ data: msg }), 0);
    }),
    set onmessage(fn: any) {
      ch1OnMessage = fn;
    },
    get onmessage() {
      return ch1OnMessage;
    },
  };

  const ch2: any = {
    readyState: "open",
    send: jest.fn((msg) => {
      setTimeout(() => ch1OnMessage?.({ data: msg }), 0);
    }),
    set onmessage(fn: any) {
      ch2OnMessage = fn;
    },
    get onmessage() {
      return ch2OnMessage;
    },
  };

  return { ch1, ch2 };
}

describe("MeshSyncProtocol Acceptance Criteria (#7231)", () => {
  it("Two offline browser tabs exchange missing reviews over DataChannel", async () => {
    const review1 = await createSignedReview({
      id: "rev-1",
      venueId: "venue-A",
      data: { wifiQuality: 5, comment: "Fast wifi" },
      timestamp: new Date().toISOString(),
    });

    const peerA = new MeshSyncProtocol([review1]);
    const peerB = new MeshSyncProtocol([]);

    const { ch1, ch2 } = createMockChannelPair();
    peerA.registerDataChannel(ch1);
    peerB.registerDataChannel(ch2);

    if (ch2.onopen) ch2.onopen();

    // Allow async message dispatch
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(peerB.getReviews().map((r) => r.payload.id)).toContain("rev-1");
  });

  it("Tampered reviews fail ECDSA signature check and are discarded", async () => {
    const validReview = await createSignedReview({
      id: "rev-2",
      venueId: "venue-B",
      data: { wifiQuality: 4, comment: "Decent place" },
      timestamp: new Date().toISOString(),
    });

    // Tamper the payload data
    const tamperedReview: SignedReviewAttestation = {
      ...validReview,
      payload: {
        ...validReview.payload,
        data: { wifiQuality: 1, comment: "Hacked review!" },
      },
    };

    const isSigValid = await verifyECDSASignature(tamperedReview);
    expect(isSigValid).toBe(false);

    const peer = new MeshSyncProtocol([]);
    const { ch1, ch2 } = createMockChannelPair();
    peer.registerDataChannel(ch2);

    // Send tampered review directly
    ch2.onmessage({
      data: JSON.stringify({ type: "SYNC_REVIEWS", reviews: [tamperedReview] }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Must be discarded
    expect(peer.getReviews().length).toBe(0);
  });
});