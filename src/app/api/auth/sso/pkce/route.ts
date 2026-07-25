import { NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  validateCodeVerifier,
} from "@/lib/auth/sso/pkce";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { action, verifier, challenge } = await request.json();

    if (action === "generate") {
      const newVerifier = generateCodeVerifier();
      const newChallenge = generateCodeChallenge(newVerifier);

      // Store the active code challenge/verifier securely in an HTTP-only session cookie
      const cookieStore = await cookies();
      cookieStore.set("pkce_verifier", newVerifier, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 15, // 15 minutes
      });
      cookieStore.set("pkce_challenge", newChallenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 15, // 15 minutes
      });

      return NextResponse.json({
        success: true,
        verifier: newVerifier,
        challenge: newChallenge,
      });
    }

    if (action === "validate") {
      const cookieStore = await cookies();
      const storedVerifier = cookieStore.get("pkce_verifier")?.value;
      const storedChallenge = cookieStore.get("pkce_challenge")?.value;

      const verifierToUse = verifier || storedVerifier;
      const challengeToUse = challenge || storedChallenge;

      if (!verifierToUse || !challengeToUse) {
        return NextResponse.json(
          { error: "Missing verifier or challenge for validation" },
          { status: 400 },
        );
      }

      const isValid = validateCodeVerifier(verifierToUse, challengeToUse);

      if (isValid) {
        // Clear the cookies after successful validation
        cookieStore.delete("pkce_verifier");
        cookieStore.delete("pkce_challenge");
      }

      return NextResponse.json({
        success: true,
        isValid,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'generate' or 'validate'." },
      { status: 400 },
    );
  } catch (error: any) {
    console.error("PKCE operation failed:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
