import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { getRpId, getOrigin } from "@/lib/passkey";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { registrationResponse, name } = body as {
      registrationResponse: RegistrationResponseJSON;
      name?: string;
    };

    if (!registrationResponse) {
      return NextResponse.json(
        { error: "Registration response is required" },
        { status: 400 },
      );
    }

    // Find the most recent active challenge for this user
    const challengeRecord = await prisma.passkeyChallenge.findFirst({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challengeRecord) {
      return NextResponse.json(
        { error: "Passkey challenge expired or missing. Please try again." },
        { status: 400 },
      );
    }

    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: "Passkey verification failed" },
        { status: 400 },
      );
    }

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
      verification.registrationInfo;

    // Delete spent challenge
    await prisma.passkeyChallenge
      .delete({
        where: { id: challengeRecord.id },
      })
      .catch(() => {});

    // Save newly verified credential
    const newPasskey = await prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports || [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: name?.trim() || "Passkey Credential",
        aaguid: aaguid || null,
      },
    });

    return NextResponse.json({
      verified: true,
      credential: {
        id: newPasskey.id,
        credentialId: newPasskey.credentialId,
        name: newPasskey.name,
        deviceType: newPasskey.deviceType,
        backedUp: newPasskey.backedUp,
        createdAt: newPasskey.createdAt,
      },
    });
  } catch (error) {
    console.error("Error verifying passkey registration:", error);
    return NextResponse.json(
      { error: "Failed to verify passkey registration" },
      { status: 500 },
    );
  }
}
