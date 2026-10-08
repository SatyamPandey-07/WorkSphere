import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { verifyPasskeyRegistration } from "@/lib/passkey/registration";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";

import { passkeyAuditLogService } from "@/lib/auth/passkeys/server/auditLog";
import { detectDeviceDetails, inferDeviceNickname } from "@/lib/auth/passkeys/deviceDetection";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { registrationResponse, name, nickname, cancelled } = body as {
      registrationResponse?: RegistrationResponseJSON;
      name?: string;
      nickname?: string;
      cancelled?: boolean;
    };

    if (cancelled) {
      await prisma.passkeyChallenge
        .deleteMany({
          where: { userId },
        })
        .catch(() => {});
      return NextResponse.json({ ok: false, error: "Registration cancelled" }, { status: 200 });
    }

    if (!registrationResponse) {
      await prisma.passkeyChallenge
        .deleteMany({
          where: { userId },
        })
        .catch(() => {});
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
      await prisma.passkeyChallenge
        .deleteMany({
          where: { userId },
        })
        .catch(() => {});
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
    const customNickname = (nickname?.trim() || name?.trim())?.slice(0, 64);
    const assignedName =
      customNickname ||
      inferDeviceNickname(userAgent, credential.transports, credential.aaguid) ||
      detected.suggestedNickname;

    const now = new Date();

    // Save newly verified credential with nickname and lastUsedAt timestamp
    const newPasskey = await prisma.passkeyCredential.create({
      data: {
        userId,
        ...credential,
        name: assignedName,
        lastUsedAt: now,
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
      details: `Registered via ${detected.authenticatorName} (${newPasskey.deviceType}) with nickname "${assignedName}"`,
    });

    return NextResponse.json({
      verified: true,
      credential: {
        id: newPasskey.id,
        credentialId: newPasskey.credentialId,
        name: newPasskey.name,
        nickname: newPasskey.name,
        deviceType: newPasskey.deviceType,
        backedUp: newPasskey.backedUp,
        createdAt: newPasskey.createdAt,
        lastUsedAt: newPasskey.lastUsedAt,
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
