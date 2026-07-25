import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { RP_NAME, getRpId } from "@/lib/passkey";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await ensureUserExists(userId);
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userPasskeys = await prisma.passkeyCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userID: new TextEncoder().encode(userId),
      userName: dbUser.email || userId,
      userDisplayName:
        `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim() ||
        dbUser.email ||
        userId,
      excludeCredentials: userPasskeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
      attestationType: "direct",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    // Save challenge to database (expires in 2 minutes)
    await prisma.passkeyChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });

    return NextResponse.json(options);
  } catch (error) {
    console.error("Error generating registration options:", error);
    return NextResponse.json(
      { error: "Failed to generate passkey registration options" },
      { status: 500 },
    );
  }
}
