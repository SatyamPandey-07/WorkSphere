import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminUser } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/user/me — lightweight capability flags for the signed-in user's UI. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ signedIn: false, isAdmin: false });
  }

  const admin = await getAdminUser().catch(() => null);
  return NextResponse.json(
    { signedIn: true, isAdmin: Boolean(admin) },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
