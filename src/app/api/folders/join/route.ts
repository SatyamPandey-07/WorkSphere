import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureUserExists } from "@/lib/auth";
import {
  isCollectionInviteExpired,
  normalizeCollectionInviteEmail,
} from "@/lib/collections/invite-utils";
import { prisma } from "@/lib/prisma";

const joinSchema = z.object({ token: z.string().min(20) });

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid invitation token" },
        { status: 400 },
      );
    }

    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid invitation token" },
        { status: 400 },
      );
    }

    const invite = await prisma.folderInvite.findUnique({
      where: { token: parsed.data.token },
      include: { folder: { select: { id: true, name: true } } },
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    const expired =
      invite.status === "EXPIRED" ||
      isCollectionInviteExpired(invite.expiresAt);

    if (expired) {
      // Best-effort status flip — never turn an expired invite into a 500
      if (invite.status === "PENDING") {
        try {
          await prisma.folderInvite.update({
            where: { id: invite.id },
            data: { status: "EXPIRED" },
          });
        } catch (err) {
          console.error("Failed to mark invitation expired:", err);
        }
      }

      return NextResponse.json(
        {
          error:
            "This invitation has expired. Ask the collection owner for a new invite link.",
        },
        { status: 410 },
      );
    }

    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: "This invitation is no longer valid" },
        { status: 410 },
      );
    }

    const user = await currentUser();
    const signedInEmails =
      user?.emailAddresses.map((entry) =>
        normalizeCollectionInviteEmail(entry.emailAddress),
      ) ?? [];

    if (
      !signedInEmails.includes(normalizeCollectionInviteEmail(invite.email))
    ) {
      return NextResponse.json(
        {
          error: "Sign in with the email address that received this invitation",
        },
        { status: 403 },
      );
    }

    await prisma.$transaction([
      prisma.folderMember.upsert({
        where: {
          folderId_userId: { folderId: invite.folderId, userId },
        },
        update: { role: invite.role },
        create: { folderId: invite.folderId, userId, role: invite.role },
      }),
      prisma.folderInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      folderId: invite.folder.id,
      folderName: invite.folder.name,
    });
  } catch (error) {
    console.error("POST /api/folders/join error:", error);
    return NextResponse.json(
      { error: "Failed to accept collection invitation" },
      { status: 500 },
    );
  }
}
