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
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    if (!(await rateLimit(`passkey-stepup-options:${userId || ip}`, 20))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a minute." },
        { status: 429 },
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "step_up";

    // Clean up expired challenges
    await prisma.passkeyChallenge
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => {});

    const userPasskeys = await prisma.passkeyCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    if (userPasskeys.length === 0) {
      return NextResponse.json(
        { error: "No registered passkeys found for user." },
        { status: 400 },
      );
    }

    // Generate options requiring user verification (biometrics / device PIN)
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      userVerification: "required",
      allowCredentials: userPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
    });

    // Save transient challenge (valid for 2 minutes)
    await prisma.passkeyChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });

    return NextResponse.json({
      options,
      action,
    });
  } catch (error) {
    console.error("Error generating step-up authentication options:", error);
    return NextResponse.json(
      { error: "Failed to generate step-up authentication options" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
