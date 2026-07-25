import { NextResponse } from "next/server";
import { resolveIdpMetadata } from "@/lib/auth/sso/metadataResolver";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const metadataUrl = searchParams.get("url");

    if (!metadataUrl) {
      return NextResponse.json({ error: "Missing metadata URL parameter" }, { status: 400 });
    }

    const metadata = await resolveIdpMetadata(metadataUrl);

    // In a real scenario, you would save this resolved metadata to your database 
    // for the specific tenant so you don't have to fetch it on every login.

    return NextResponse.json({
      success: true,
      metadata,
    });
  } catch (error: any) {
    console.error("Failed to resolve IDP metadata:", error);
    return NextResponse.json({ error: error.message || "Failed to resolve metadata" }, { status: 500 });
  }
}
