import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name } = body as { name?: string };

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Passkey name is required" },
        { status: 400 },
      );
    }

    const passkey = await prisma.passkeyCredential.findFirst({
      where: { id, userId },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.passkeyCredential.update({
      where: { id },
      data: { name: name.trim() },
      select: {
        id: true,
        credentialId: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json({ credential: updated });
  } catch (error) {
    console.error("Error updating passkey:", error);
    return NextResponse.json(
      { error: "Failed to update passkey" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const passkey = await prisma.passkeyCredential.findFirst({
      where: { id, userId },
    });

    if (!passkey) {
      return NextResponse.json(
        { error: "Passkey credential not found" },
        { status: 404 },
      );
    }

    await prisma.passkeyCredential.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting passkey:", error);
    return NextResponse.json(
      { error: "Failed to delete passkey" },
      { status: 500 },
    );
  }
}
