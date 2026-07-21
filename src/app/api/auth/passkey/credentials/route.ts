import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const passkeys = await prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        credentialId: true,
        name: true,
        deviceType: true,
        backedUp: true,
        transports: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json({ credentials: passkeys });
  } catch (error) {
    console.error("Error listing passkeys:", error);
    return NextResponse.json(
      { error: "Failed to list passkeys" },
      { status: 500 },
    );
  }
}
