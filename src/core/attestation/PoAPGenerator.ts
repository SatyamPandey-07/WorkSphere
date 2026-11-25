/**
 * PoAPGenerator.ts
 * Generates the unique cryptographic payload and metadata for the Proof-of-Attendance badge upon successful check-in.
 * Combines venue ID, user ID, timestamp, and sensor data into a verifiable claim.
 */

import crypto from "crypto";

export interface PoAPClaim {
  id: string;
  userId: string;
  venueId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  wifiSsid: string;
  sensorHash: string;
  nonce: string;
}

export class PoAPGenerator {
  public generateClaim(
    userId: string,
    venueId: string,
    latitude: number,
    longitude: number,
    wifiSsid: string,
    sensorData: string,
    nonce?: string,
  ): PoAPClaim {
    const sensorHash = this.hashString(sensorData);
    const claimNonce = nonce || crypto.randomBytes(16).toString("hex");

    return {
      id: crypto.randomUUID(),
      userId,
      venueId,
      timestamp: Date.now(),
      latitude,
      longitude,
      wifiSsid,
      sensorHash,
      nonce: claimNonce,
    };
  }

  public serializeClaim(claim: PoAPClaim): string {
    return JSON.stringify(claim);
  }

  public signClaim(claim: PoAPClaim, secretKey: string): string {
    const serialized = this.serializeClaim(claim);
    return crypto
      .createHmac("sha256", secretKey)
      .update(serialized)
      .digest("hex");
  }

  public verifyClaimSignature(
    claim: PoAPClaim,
    signature: string,
    secretKey: string,
  ): boolean {
    if (!signature || signature.length !== 64) return false;
    const expected = this.signClaim(claim, secretKey);
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  }

  public hashString(str: string): string {
    return crypto.createHash("sha256").update(str).digest("hex");
  }
}
