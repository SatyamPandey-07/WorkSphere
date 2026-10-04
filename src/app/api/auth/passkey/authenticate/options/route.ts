import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { getRpId } from "@/lib/passkey";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { rateLimit } from "@/lib/rateLimit";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();

    // Public endpoint that writes a challenge row: throttle per caller.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    if (!(await rateLimit(`passkey-options:${userId || ip}`, 20))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a minute." },
        { status: 429 },
      );
    }

    // Opportunistically clear expired challenges so the table stays small.
    await prisma.passkeyChallenge
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {});

    let userPasskeys: { credentialId: string; transports: string[] }[] = [];

    if (userId) {
      userPasskeys = await prisma.passkeyCredential.findMany({
        where: { userId },
        select: { credentialId: true, transports: true },
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      userVerification: "preferred",
      allowCredentials: userPasskeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
    });

    // Save transient challenge (expires in 2 minutes)
    await prisma.passkeyChallenge.create({
      data: {
        userId: userId || null,
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });

    return NextResponse.json(options);
  } catch (error) {
    console.error("Error generating authentication options:", error);
    return NextResponse.json(
      { error: "Failed to generate passkey authentication options" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
