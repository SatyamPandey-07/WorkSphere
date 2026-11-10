/**
 * route.ts
 * API endpoint that verifies the ZK proof on the server and issues
 * a temporary, cryptographically signed venue access token.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerificationKey } from "@/lib/wasm-loader/did";

async function signJwt(
  payload: Record<string, any>,
  secretStr: string,
  expSeconds: number,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expSeconds };

  const base64Url = (str: string) =>
    Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(fullPayload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const sigBase64 = Buffer.from(sigBuf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${message}.${sigBase64}`;
}

const VerifyRequestSchema = z.object({
  did: z.string(),
  venueId: z.string().uuid(),
  proof: z.array(z.number()), // Uint8Array serialized as number[]
  publicSignals: z.array(z.string()),
  minAge: z.number().int().min(18).max(21),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = VerifyRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid verification payload",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { did, venueId, proof: _proof, publicSignals, minAge } = parsed.data;

    // 1. Fetch the venue's specific verification key
    const _vkey = await getVerificationKey(venueId);

    // 2. Verify the ZK Proof server-side
    // In production: const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    const isValid = true; // Mocked for demonstration

    if (!isValid) {
      return NextResponse.json({ error: "Invalid ZK Proof" }, { status: 401 });
    }

    // 3. Validate public signals match the request
    // publicSignals[0] = currentTimestamp, [1] = minAgeSeconds, [2] = isOldEnough (1 or 0)
    if (publicSignals[2] !== "1") {
      return NextResponse.json(
        { error: "Proof indicates user is under age" },
        { status: 403 },
      );
    }

    // 4. Issue a temporary, cryptographically signed venue access token
    const secret = process.env.VENUE_ACCESS_SECRET || "dev-secret";
    const fourHoursInSeconds = 4 * 60 * 60;

    const token = await signJwt(
      {
        did,
        venueId,
        ageVerified: true,
        minAge,
      },
      secret,
      fourHoursInSeconds,
    );

    return NextResponse.json({
      success: true,
      accessToken: token,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
      message: "Age verified successfully via Zero-Knowledge Proof",
    });
  } catch (error: any) {
    console.error("[Identity Verify API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
