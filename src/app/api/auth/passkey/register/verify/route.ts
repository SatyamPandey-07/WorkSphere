import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { verifyPasskeyRegistration } from "@/lib/passkey/registration";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";

import { passkeyAuditLogService } from "@/lib/auth/passkeys/server/auditLog";
import { detectDeviceDetails } from "@/lib/auth/passkeys/deviceDetection";

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

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "";
    const detected = detectDeviceDetails(userAgent, credential.transports, credential.aaguid);
    const assignedName = name?.trim().slice(0, 64) || detected.suggestedNickname;

    // Save newly verified credential
    const newPasskey = await prisma.passkeyCredential.create({
      data: {
        userId,
        ...credential,
        name: assignedName,
      },
    });

    // Record in Security Audit Log
    passkeyAuditLogService.log({
      userId,
      credentialId: newPasskey.credentialId,
      credentialName: newPasskey.name,
      action: "REGISTER",
      status: "SUCCESS",
      ipAddress: ip,
      userAgent,
      details: `Registered via ${detected.authenticatorName} (${newPasskey.deviceType})`,
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
