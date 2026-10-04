import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { getRpId, getExpectedOrigin } from "@/lib/passkey";
import { parseClientDataJSON } from "@/lib/webauthn";
import { parseAuthenticatorFlags, evaluateCredentialBackupStatus } from "@/lib/passkey/backupState";
import { issueStepUpToken } from "@/lib/auth/stepUpAuth";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    if (!(await rateLimit(`passkey-stepup-verify:${userId || ip}`, 10))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a minute." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { authenticationResponse, action = "step_up" } = body as {
      authenticationResponse: AuthenticationResponseJSON;
      action?: string;
    };

    if (!authenticationResponse) {
      return NextResponse.json(
        { error: "Authentication response is required" },
        { status: 400 },
      );
    }

    // Lookup passkey belonging to the active user
    const passkey = await prisma.passkeyCredential.findFirst({
      where: {
        credentialId: authenticationResponse.id,
        userId,
      },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not recognized for this account" },
        { status: 404 },
      );
    }

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
      (challengeRecord.userId !== null && challengeRecord.userId !== userId)
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
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      const msg =
        verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      const isChallengeError = /challenge|expired|unexpected.*challenge/i.test(
        msg,
      );
      return NextResponse.json(
        {
          error: isChallengeError
            ? "Passkey authentication challenge expired. Please try again."
            : "Passkey step-up assertion verification failed",
        },
        { status: 400 },
      );
    }

    if (!verification.verified || !verification.authenticationInfo) {
      return NextResponse.json(
        { error: "Passkey step-up verification failed" },
        { status: 400 },
      );
    }

    const { newCounter, credentialDeviceType, credentialBackedUp, authenticatorData } =
      verification.authenticationInfo;

    // Parse authenticator data flags to determine user verification and backup state
    const parsedFlags = authenticatorData
      ? parseAuthenticatorFlags(authenticatorData)
      : {
          userPresent: true,
          userVerified: true,
          backupEligible: credentialDeviceType === "multiDevice",
          backedUp: credentialBackedUp,
          attestedCredentialData: false,
          extensionData: false,
          deviceType: credentialDeviceType === "multiDevice" ? ("multi_device" as const) : ("single_device" as const),
          riskLevel: "low" as const,
        };

    const backupStatus = evaluateCredentialBackupStatus({
      backedUp: credentialBackedUp,
      deviceType: credentialDeviceType,
      counter: newCounter,
      lastUsedAt: new Date(),
    });

    // Update signature counter, backedUp state, deviceType, and lastUsedAt timestamp
    await prisma.passkeyCredential.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        backedUp: credentialBackedUp,
        deviceType: credentialDeviceType,
        lastUsedAt: new Date(),
      },
    });

    // Delete spent challenge
    await prisma.passkeyChallenge
      .delete({
        where: { id: challengeRecord.id },
      })
      .catch(() => {});

    // Issue cryptographic Step-Up token
    const stepUpToken = issueStepUpToken(
      userId,
      action,
      passkey.credentialId,
      parsedFlags.userVerified,
    );

    return NextResponse.json({
      verified: true,
      stepUpToken,
      credentialId: passkey.credentialId,
      action,
      flags: parsedFlags,
      backupStatus,
    });
  } catch (error) {
    console.error("Error verifying passkey step-up authentication:", error);
    return NextResponse.json(
      { error: "Failed to verify step-up authentication" },
      { status: 500 },
    );
  }
}
