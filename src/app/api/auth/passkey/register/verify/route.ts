import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { verifyPasskeyRegistration } from "@/lib/passkey/registration";
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

    const result = await verifyPasskeyRegistration(
      req,
      userId,
      registrationResponse,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { challengeId, credential } = result.registration;

    // Delete spent challenge
    await prisma.passkeyChallenge
      .delete({
        where: { id: challengeId },
      })
      .catch(() => {});

    // Save newly verified credential
    const newPasskey = await prisma.passkeyCredential.create({
      data: {
        userId,
        ...credential,
        name: name?.trim().slice(0, 64) || "Passkey Credential",
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
