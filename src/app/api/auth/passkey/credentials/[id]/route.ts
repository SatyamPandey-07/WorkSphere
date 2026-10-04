import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  consumePasskeyOtp,
  otpErrorMessage,
  verifyPasskeyOtp,
} from "@/lib/passkey/emailOtp";

const MAX_PASSKEY_NAME_LENGTH = 64;

class OtpAlreadyUsedError extends Error {}

const otpReplayResponse = () =>
  NextResponse.json(
    { error: "This verification code was already used. Request a new code." },
    { status: 403 },
  );

/** PATCH — rename a passkey. Requires an email OTP issued for "rename" (#1991). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { name, otp } = body as { name?: string; otp?: string };

    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) {
      return NextResponse.json(
        { error: "Passkey name is required" },
        { status: 400 },
      );
    }
    if (trimmed.length > MAX_PASSKEY_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Passkey name must be at most ${MAX_PASSKEY_NAME_LENGTH} characters` },
        { status: 400 },
      );
    }

    const passkey = await prisma.passkeyCredential.findFirst({
      where: { id, userId },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not found" },
        { status: 404 },
      );
    }

    const check = await verifyPasskeyOtp({
      userId,
      action: "rename",
      credentialId: id,
      code: otp,
    });
    if (!check.ok) {
      return NextResponse.json({ error: otpErrorMessage(check) }, { status: 403 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (!(await consumePasskeyOtp(check.otpId, tx))) {
        throw new OtpAlreadyUsedError();
      }
      return tx.passkeyCredential.update({
        where: { id },
        data: { name: trimmed },
        select: {
          id: true,
          credentialId: true,
          name: true,
          deviceType: true,
          backedUp: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });
    });

    return NextResponse.json({ credential: updated });
  } catch (error) {
    if (error instanceof OtpAlreadyUsedError) return otpReplayResponse();
    console.error("Error updating passkey:", error);
    return NextResponse.json(
      { error: "Failed to update passkey" },
      { status: 500 },
    );
  }
}

/** DELETE — revoke a passkey. Requires an email OTP issued for "revoke" (#1991). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { otp } = body as { otp?: string };

    const passkey = await prisma.passkeyCredential.findFirst({
      where: { id, userId },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not found" },
        { status: 404 },
      );
    }

    const check = await verifyPasskeyOtp({
      userId,
      action: "revoke",
      credentialId: id,
      code: otp,
    });
    if (!check.ok) {
      return NextResponse.json({ error: otpErrorMessage(check) }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      if (!(await consumePasskeyOtp(check.otpId, tx))) {
        throw new OtpAlreadyUsedError();
      }
      await tx.passkeyCredential.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof OtpAlreadyUsedError) return otpReplayResponse();
    console.error("Error deleting passkey:", error);
    return NextResponse.json(
      { error: "Failed to delete passkey" },
      { status: 500 },
    );
  }
}
