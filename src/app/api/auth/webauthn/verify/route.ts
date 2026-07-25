import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseClientDataJSON, verifyWebAuthnChallenge } from "@/lib/webauthn";

const bodySchema = z.object({
  clientDataJSON: z.string().min(1),
  expectedChallenge: z.string().min(1),
  // optional — when unset we derive / read WEBAUTHN_RP_ID
  rpId: z.string().min(1).optional(),
});

/**
 * POST /api/auth/webauthn/verify
 *
 * Checks the WebAuthn clientData challenge and that the assertion origin is
 * allowed for the normalized RP ID (parent domain + subdomains).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed." }, { status: 400 });
  }

  const { clientDataJSON, expectedChallenge, rpId } = parsed.data;
  const clientData = parseClientDataJSON(clientDataJSON);

  if (!clientData?.challenge || !clientData.origin) {
    return NextResponse.json(
      { error: "Invalid WebAuthn challenge signature" },
      { status: 401 },
    );
  }

  if (clientData.type && clientData.type !== "webauthn.get") {
    return NextResponse.json(
      { error: "Invalid WebAuthn challenge signature" },
      { status: 401 },
    );
  }

  const result = verifyWebAuthnChallenge({
    origin: clientData.origin,
    challenge: clientData.challenge,
    expectedChallenge,
    rpId,
    userAgent: req.headers.get("user-agent"),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  return NextResponse.json({
    verified: true,
    rpId: result.rpId,
  });
}
