/**
 * DTLSHandshake.ts
 * Handles the Datagram Transport Layer Security negotiation to ensure end-to-end packet encryption.
 * Wraps the WebRTC native DTLS implementation with additional application-layer verification
 * and stateless cookie verification with 60-second sliding window and rotating secrets (#5440).
 */

import crypto from "crypto";

export interface HandshakePayload {
  sessionId: string;
  publicKey: string;
  signature: string;
  timestamp: number;
}

export interface DtlsCookieValidationResult {
  isValid: boolean;
  reason?:
    "valid" | "expired" | "invalid_signature" | "malformed" | "clock_skew";
  ageMs?: number;
  timestamp?: number;
}

export class DTLSHandshake {
  private localPrivateKey: CryptoKey | null = null;
  private localPublicKey: string | null = null;
  private verifiedPeers: Set<string> = new Set();

  // Stateless Cookie Secret & Window Configuration
  private serverSecret: string;
  private previousServerSecret: string | null = null;
  private lastRotationTime: number;
  public readonly SLIDING_WINDOW_MS: number = 60 * 1000; // 60 seconds
  private rotationIntervalMs: number = 60 * 1000;

  constructor(initialSecret?: string) {
    this.serverSecret = initialSecret || crypto.randomBytes(32).toString("hex");
    this.lastRotationTime = Date.now();
    this.initializeKeys();
  }

  private async initializeKeys(): Promise<void> {
    try {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256",
        },
        true,
        ["sign", "verify"],
      );

      this.localPrivateKey = keyPair.privateKey;

      const exportedKey = await crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey,
      );
      this.localPublicKey = btoa(
        String.fromCharCode(...new Uint8Array(exportedKey)),
      );
    } catch (error) {
      console.error("Failed to initialize DTLS handshake keys:", error);
    }
  }

  /**
   * Checks if the server secret has exceeded its 60-second rotation window and rotates if necessary.
   */
  private checkSecretRotation(now: number = Date.now()): void {
    if (now - this.lastRotationTime >= this.rotationIntervalMs) {
      this.rotateServerSecret();
    }
  }

  /**
   * Manually rotates the server secret, shifting the current secret to previousSecret
   * to support sliding window transitions.
   */
  public rotateServerSecret(newSecret?: string): void {
    this.previousServerSecret = this.serverSecret;
    this.serverSecret = newSecret || crypto.randomBytes(32).toString("hex");
    this.lastRotationTime = Date.now();
  }

  public getCurrentSecret(): string {
    return this.serverSecret;
  }

  public getPreviousSecret(): string | null {
    return this.previousServerSecret;
  }

  public getLastRotationTime(): number {
    return this.lastRotationTime;
  }

  public setRotationInterval(intervalMs: number): void {
    this.rotationIntervalMs = intervalMs;
  }

  private buildCookieData(
    clientIp: string,
    clientPort: number,
    timestamp: number,
    clientRandom: string,
  ): string {
    return `${clientIp}:${clientPort}:${timestamp}:${clientRandom}`;
  }

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      const bufA = Buffer.from(a, "hex");
      const bufB = Buffer.from(b, "hex");
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Generates a stateless DTLS cookie embedding a UNIX timestamp and HMAC-SHA256 signature
   * over client IP, port, timestamp, and optional client random.
   */
  public generateStatelessCookie(
    clientIp: string,
    clientPort: number,
    clientRandom: string = "",
    timestamp: number = Date.now(),
  ): string {
    this.checkSecretRotation(timestamp);
    const data = this.buildCookieData(
      clientIp,
      clientPort,
      timestamp,
      clientRandom,
    );
    const hmac = crypto
      .createHmac("sha256", this.serverSecret)
      .update(data)
      .digest("hex");
    return `${timestamp}:${hmac}`;
  }

  /**
   * Validates a DTLS cookie enforcing the 60-second sliding timestamp window and HMAC-SHA256 signature.
   */
  public validateStatelessCookie(
    cookie: string,
    clientIp: string,
    clientPort: number,
    clientRandom: string = "",
    currentTime?: number,
  ): DtlsCookieValidationResult {
    const now = currentTime !== undefined ? currentTime : Date.now();
    this.checkSecretRotation(now);

    if (!cookie || typeof cookie !== "string") {
      return { isValid: false, reason: "malformed" };
    }

    const colonIdx = cookie.indexOf(":");
    if (colonIdx === -1) {
      return { isValid: false, reason: "malformed" };
    }

    const tsStr = cookie.substring(0, colonIdx);
    const signature = cookie.substring(colonIdx + 1);
    const timestamp = parseInt(tsStr, 10);

    if (isNaN(timestamp) || !signature) {
      return { isValid: false, reason: "malformed" };
    }

    const ageMs = now - timestamp;

    // Reject future timestamps exceeding allowable clock skew (5 seconds)
    if (timestamp > now + 5000) {
      return { isValid: false, reason: "clock_skew", ageMs, timestamp };
    }

    // Reject cookies older than 60-second sliding window (replay attack defense)
    if (ageMs > this.SLIDING_WINDOW_MS) {
      return { isValid: false, reason: "expired", ageMs, timestamp };
    }

    const data = this.buildCookieData(
      clientIp,
      clientPort,
      timestamp,
      clientRandom,
    );

    // Verify with current rotating secret
    const expectedCurrent = crypto
      .createHmac("sha256", this.serverSecret)
      .update(data)
      .digest("hex");
    if (this.constantTimeEqual(signature, expectedCurrent)) {
      return { isValid: true, reason: "valid", ageMs, timestamp };
    }

    // Verify with previous secret if within sliding window
    if (this.previousServerSecret) {
      const expectedPrev = crypto
        .createHmac("sha256", this.previousServerSecret)
        .update(data)
        .digest("hex");
      if (this.constantTimeEqual(signature, expectedPrev)) {
        return { isValid: true, reason: "valid", ageMs, timestamp };
      }
    }

    return { isValid: false, reason: "invalid_signature", ageMs, timestamp };
  }

  /**
   * Verifies a DTLS cookie, returning boolean status.
   */
  public verifyStatelessCookie(
    cookie: string,
    clientIp: string,
    clientPort: number,
    clientRandom: string = "",
    currentTime?: number,
  ): boolean {
    return this.validateStatelessCookie(
      cookie,
      clientIp,
      clientPort,
      clientRandom,
      currentTime,
    ).isValid;
  }

  public async generateHandshakePayload(
    sessionId: string,
  ): Promise<HandshakePayload | null> {
    if (!this.localPrivateKey || !this.localPublicKey) {
      console.error("Keys not initialized");
      return null;
    }

    const timestamp = Date.now();
    const dataToSign = new TextEncoder().encode(
      `${sessionId}:${this.localPublicKey}:${timestamp}`,
    );

    const signatureBuffer = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.localPrivateKey,
      dataToSign,
    );

    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer)),
    );

    return {
      sessionId,
      publicKey: this.localPublicKey,
      signature,
      timestamp,
    };
  }

  public async verifyHandshakePayload(
    payload: HandshakePayload,
  ): Promise<boolean> {
    try {
      const { sessionId, publicKey, signature, timestamp } = payload;

      // Check timestamp freshness (e.g., within 5 minutes)
      if (Date.now() - timestamp > 5 * 60 * 1000) {
        console.warn("Handshake payload expired");
        return false;
      }

      const keyData = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey(
        "spki",
        keyData,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );

      const dataToVerify = new TextEncoder().encode(
        `${sessionId}:${publicKey}:${timestamp}`,
      );
      const signatureBuffer = Uint8Array.from(atob(signature), (c) =>
        c.charCodeAt(0),
      );

      const isValid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        cryptoKey,
        signatureBuffer,
        dataToVerify,
      );

      if (isValid) {
        this.verifiedPeers.add(sessionId);
      }

      return isValid;
    } catch (error) {
      console.error("Handshake verification failed:", error);
      return false;
    }
  }

  public isPeerVerified(sessionId: string): boolean {
    return this.verifiedPeers.has(sessionId);
  }
}
