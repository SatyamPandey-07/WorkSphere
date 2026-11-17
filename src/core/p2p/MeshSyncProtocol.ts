// Simple 256-bit Bloom Filter implementation for review IDs
export class SimpleBloomFilter {
  private bits: Uint8Array;
  private size: number;

  constructor(sizeInBytes = 32) {
    this.size = sizeInBytes * 8;
    this.bits = new Uint8Array(sizeInBytes);
  }

  private hash(str: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    return Math.abs(h % this.size);
  }

  add(item: string) {
    const h1 = this.hash(item, 11);
    const h2 = this.hash(item, 37);
    this.bits[Math.floor(h1 / 8)] |= 1 << (h1 % 8);
    this.bits[Math.floor(h2 / 8)] |= 1 << (h2 % 8);
  }

  has(item: string): boolean {
    const h1 = this.hash(item, 11);
    const h2 = this.hash(item, 37);
    const b1 = (this.bits[Math.floor(h1 / 8)] & (1 << (h1 % 8))) !== 0;
    const b2 = (this.bits[Math.floor(h2 / 8)] & (1 << (h2 % 8))) !== 0;
    return b1 && b2;
  }

  toBase64(): string {
    return Buffer.from(this.bits).toString("base64");
  }

  static fromBase64(b64: string): SimpleBloomFilter {
    const bf = new SimpleBloomFilter();
    const buf = Buffer.from(b64, "base64");
    bf.bits = new Uint8Array(buf);
    bf.size = bf.bits.length * 8;
    return bf;
  }
}

export interface ReviewPayload {
  id: string;
  venueId: string;
  data: {
    wifiQuality?: number;
    hasOutlets?: boolean;
    noiseLevel?: string;
    comment?: string;
  };
  timestamp: string;
}

export interface SignedReviewAttestation {
  payload: ReviewPayload;
  signature: string; // hex string of signature
  publicKey: string; // JSON Web Key or exported key
}

// ECDSA verification using Web Crypto API
export async function verifyECDSASignature(attestation: SignedReviewAttestation): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(attestation.payload));
    const sigBytes = Buffer.from(attestation.signature, "hex");
    const jwk = JSON.parse(attestation.publicKey);

    const cryptoSubtle = globalThis.crypto?.subtle || (await import("crypto")).webcrypto.subtle;

    const key = await cryptoSubtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );

    return await cryptoSubtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      sigBytes,
      data
    );
  } catch (err) {
    return false;
  }
}

export class MeshSyncProtocol {
  private localReviews: Map<string, SignedReviewAttestation> = new Map();
  private channels: Set<RTCDataChannel> = new Set();
  public onReviewReceived?: (review: SignedReviewAttestation) => void;

  constructor(initialReviews: SignedReviewAttestation[] = []) {
    initialReviews.forEach((r) => this.localReviews.set(r.payload.id, r));
  }

  public registerDataChannel(channel: RTCDataChannel) {
    this.channels.add(channel);

    channel.onopen = () => {
      this.sendBloomFilter(channel);
    };

    channel.onmessage = async (event: MessageEvent) => {
      await this.handleMessage(channel, event.data);
    };

    channel.onclose = () => {
      this.channels.delete(channel);
    };
  }

  public getBloomFilter(): SimpleBloomFilter {
    const bf = new SimpleBloomFilter();
    for (const id of this.localReviews.keys()) {
      bf.add(id);
    }
    return bf;
  }

  private sendBloomFilter(channel: RTCDataChannel) {
    const bf = this.getBloomFilter();
    channel.send(JSON.stringify({ type: "BLOOM_FILTER", filter: bf.toBase64() }));
  }

  private async handleMessage(channel: RTCDataChannel, rawData: string) {
    try {
      const msg = JSON.parse(rawData);
      if (msg.type === "BLOOM_FILTER") {
        const peerFilter = SimpleBloomFilter.fromBase64(msg.filter);
        const missingForPeer: SignedReviewAttestation[] = [];

        // Check which of our reviews peer might be missing
        for (const [id, attestation] of this.localReviews.entries()) {
          if (!peerFilter.has(id)) {
            missingForPeer.push(attestation);
          }
        }

        if (missingForPeer.length > 0) {
          channel.send(JSON.stringify({ type: "SYNC_REVIEWS", reviews: missingForPeer }));
        }
      } else if (msg.type === "SYNC_REVIEWS") {
        const reviews: SignedReviewAttestation[] = msg.reviews || [];
        for (const item of reviews) {
          const isValid = await verifyECDSASignature(item);
          if (isValid) {
            this.localReviews.set(item.payload.id, item);
            if (this.onReviewReceived) {
              this.onReviewReceived(item);
            }
          } else {
            // Discard tampered review as per acceptance criteria
            console.warn(`[MeshSync] Discarded tampered review: ${item.payload?.id}`);
          }
        }
      }
    } catch (err) {
      console.error("[MeshSync] Error handling message:", err);
    }
  }

  public addReview(attestation: SignedReviewAttestation) {
    this.localReviews.set(attestation.payload.id, attestation);
    // Gossip to all connected peers
    const payload = JSON.stringify({ type: "SYNC_REVIEWS", reviews: [attestation] });
    for (const ch of this.channels) {
      if (ch.readyState === "open") {
        ch.send(payload);
      }
    }
  }

  public getReviews(): SignedReviewAttestation[] {
    return Array.from(this.localReviews.values());
  }
}