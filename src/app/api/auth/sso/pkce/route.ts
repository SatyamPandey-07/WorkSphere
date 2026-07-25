import { NextResponse } from "next/server";
import { generateCodeVerifier, generateCodeChallenge, validateCodeVerifier } from "@/lib/auth/sso/pkce";

export async function POST(request: Request) {
  try {
    const { action, verifier, challenge } = await request.json();

    if (action === "generate") {
      // 1. Generate a new verifier and challenge
      // In a real OAuth flow, the client generates this, stores the verifier securely, 
      // and sends the challenge to the authorization server.
      const newVerifier = generateCodeVerifier();
      const newChallenge = generateCodeChallenge(newVerifier);

      return NextResponse.json({
        success: true,
        verifier: newVerifier,
        challenge: newChallenge,
      });
    }

    if (action === "validate") {
      // 2. Validate a verifier against a challenge
      // The authorization server does this when the client exchanges the auth code for a token.
      if (!verifier || !challenge) {
        return NextResponse.json({ error: "Missing verifier or challenge for validation" }, { status: 400 });
      }

      const isValid = validateCodeVerifier(verifier, challenge);

      return NextResponse.json({
        success: true,
        isValid,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use 'generate' or 'validate'." }, { status: 400 });
  } catch (error: any) {
    console.error("PKCE operation failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
