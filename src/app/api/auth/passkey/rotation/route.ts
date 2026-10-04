import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import { prisma } from "@/lib/prisma";
import {
  getPasskeyRotationStatus,
  rotatePasskey,
  cleanupExpiredPasskeys,
  PasskeyRotationConflictError,
} from "@/lib/passkey/rotation";
import { otpErrorMessage, verifyPasskeyOtp } from "@/lib/passkey/emailOtp";
import { verifyPasskeyRegistration } from "@/lib/passkey/registration";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const statuses = await getPasskeyRotationStatus(userId);
    return NextResponse.json({ credentials: statuses });
  } catch (error) {
    console.error("Error fetching rotation status:", error);
    return NextResponse.json(
      { error: "Failed to fetch rotation status" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, credentialId, otp, registrationResponse, name } = body as {
      action: "rotate" | "cleanup";
      credentialId?: string;
      otp?: string;
      registrationResponse?: RegistrationResponseJSON;
      name?: string;
    };

    if (action === "cleanup") {
      const result = await cleanupExpiredPasskeys(userId);
      return NextResponse.json({ deletedCount: result.deletedCount });
    }

    if (action === "rotate") {
      // Rotation = register a successor credential, then revoke the old one,
      // gated by an email OTP issued for "rotate" on this credential (#1991).
      if (!credentialId || !registrationResponse) {
        return NextResponse.json(
          { error: "credentialId and registrationResponse are required for rotate" },
          { status: 400 },
        );
      }

      const existing = await prisma.passkeyCredential.findFirst({
        where: { id: credentialId, userId },
        select: { id: true, name: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Credential not found" },
          { status: 404 },
        );
      }

      const check = await verifyPasskeyOtp({
        userId,
        action: "rotate",
        credentialId,
        code: otp,
      });
      if (!check.ok) {
        return NextResponse.json(
          { error: otpErrorMessage(check) },
          { status: 403 },
        );
      }

      // Verified before the OTP is consumed, so a cancelled or failed
      // WebAuthn ceremony doesn't cost the user their code.
      const registration = await verifyPasskeyRegistration(
        req,
        userId,
        registrationResponse,
      );
      if (!registration.ok) {
        return NextResponse.json(
          { error: registration.error },
          { status: registration.status },
        );
      }

      const trimmedName = typeof name === "string" ? name.trim().slice(0, 64) : "";
      const credential = await rotatePasskey({
        userId,
        oldCredentialId: existing.id,
        otpId: check.otpId,
        registration: registration.registration,
        name: trimmedName || existing.name,
      });

      return NextResponse.json({
        success: true,
        revokedCredentialId: existing.id,
        credential,
        newExpiresAt: credential.expiresAt,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    if (error instanceof PasskeyRotationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error in rotation action:", error);
    return NextResponse.json(
      { error: "Failed to perform rotation action" },
      { status: 500 },
    );
  }
}
