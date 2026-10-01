import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { createClerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getRpId, getExpectedOrigin } from "@/lib/passkey";
import { parseClientDataJSON } from "@/lib/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
  if (!(await rateLimit(`passkey-verify:${ip}`, 10))) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute." },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const { authenticationResponse } = body as {
      authenticationResponse: AuthenticationResponseJSON;
    };

    if (!authenticationResponse) {
      return NextResponse.json(
        { error: "Authentication response is required" },
        { status: 400 },
      );
    }

    // Lookup passkey by credential ID
    const passkey = await prisma.passkeyCredential.findUnique({
      where: { credentialId: authenticationResponse.id },
      include: { user: true },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not recognized" },
        { status: 404 },
      );
    }

    // Match the exact challenge this browser signed — never "the latest one",
    // which would let concurrent sign-ins consume each other's challenges.
    const clientData = authenticationResponse.response?.clientDataJSON
      ? parseClientDataJSON(authenticationResponse.response.clientDataJSON)
      : null;

    const challengeRecord = clientData?.challenge
      ? await prisma.passkeyChallenge.findUnique({
          where: { challenge: clientData.challenge },
        })
      : null;

    if (
      !challengeRecord ||
      challengeRecord.expiresAt <= new Date() ||
      (challengeRecord.userId !== null &&
        challengeRecord.userId !== passkey.userId)
    ) {
      return NextResponse.json(
        { error: "Passkey challenge expired or missing. Please try again." },
        { status: 400 },
      );
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: authenticationResponse,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: getExpectedOrigin(req, clientData?.origin),
        expectedRPID: getRpId(req),
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (verifyErr) {
      // SimpleWebAuthn throws Error objects with descriptive messages when the
      // challenge is expired or mismatched — return 400 instead of letting the
      // outer catch return 500.
      const msg =
        verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      const isChallengeError = /challenge|expired|unexpected.*challenge/i.test(
        msg,
      );
      return NextResponse.json(
        {
          error: isChallengeError
            ? "Passkey authentication challenge expired. Please try again."
            : "Passkey assertion verification failed",
        },
        { status: 400 },
      );
    }

    if (!verification.verified || !verification.authenticationInfo) {
      return NextResponse.json(
        { error: "Passkey assertion verification failed" },
        { status: 400 },
      );
    }

    const { newCounter } = verification.authenticationInfo;

    // Update signature counter and lastUsedAt timestamp
    await prisma.passkeyCredential.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        lastUsedAt: new Date(),
      },
    });

    // Delete spent challenge
    await prisma.passkeyChallenge
      .delete({
        where: { id: challengeRecord.id },
      })
      .catch(() => {});

    // Generate Clerk sign-in ticket URL
    let signInUrl: string | null = null;
    if (process.env.CLERK_SECRET_KEY) {
      try {
        const clerk = createClerkClient({
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        const token = await clerk.signInTokens.createSignInToken({
          userId: passkey.userId,
          expiresInSeconds: 60,
        });
        signInUrl = token.url;
      } catch (err) {
        console.error("Failed to generate Clerk sign-in token:", err);
      }
    }

    return NextResponse.json({
      verified: true,
      userId: passkey.userId,
      signInUrl,
      user: {
        id: passkey.user.id,
        email: passkey.user.email,
        firstName: passkey.user.firstName,
        lastName: passkey.user.lastName,
      },
    });
  } catch (error) {
    console.error("Error verifying passkey authentication:", error);
    return NextResponse.json(
      { error: "Failed to verify passkey authentication" },
      { status: 500 },
    );
  }
}
