import crypto from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureUserExists } from "@/lib/auth";
import { sendCollectionInviteEmail } from "@/lib/collections/invite-email";
import {
  createCollectionInviteExpiry,
  normalizeCollectionInviteEmail,
} from "@/lib/collections/invite-utils";
import { hasFolderAccess } from "@/lib/folders";
import { prisma } from "@/lib/prisma";

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["EDITOR", "MEMBER"]).default("MEMBER"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureUserExists(userId);
    const { id } = await params;
    const access = await hasFolderAccess(id, userId);

    if (!access.folder) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }

    if (access.role !== "OWNER" && access.role !== "EDITOR") {
      return NextResponse.json(
        { error: "Only owners and editors can invite teammates" },
        { status: 403 },
      );
    }

    const parsed = inviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid email and collaborator role" },
        { status: 400 },
      );
    }

    const email = normalizeCollectionInviteEmail(parsed.data.email);
    const role = parsed.data.role;
    const inviter = await currentUser();
    const inviterEmails =
      inviter?.emailAddresses.map((entry) =>
        entry.emailAddress.toLowerCase(),
      ) ?? [];

    if (inviterEmails.includes(email)) {
      return NextResponse.json(
        { error: "You are already part of this collection" },
        { status: 400 },
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      const membership = await prisma.folderMember.upsert({
        where: {
          folderId_userId: {
            folderId: id,
            userId: existingUser.id,
          },
        },
        update: { role },
        create: { folderId: id, userId: existingUser.id, role },
      });

      return NextResponse.json({
        mode: "member_added",
        membership,
        message: "Existing WorkSphere user added to the collection.",
      });
    }

    await prisma.folderInvite.updateMany({
      where: { folderId: id, email, status: "PENDING" },
      data: { status: "REVOKED" },
    });

    const expiresAt = createCollectionInviteExpiry();
    const token = crypto.randomBytes(32).toString("hex");
    const invite = await prisma.folderInvite.create({
      data: { folderId: id, senderId: userId, email, role, token, expiresAt },
    });

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.nextUrl.origin ||
      "http://localhost:3000";
    const inviteUrl = `${appUrl}/collections/join?token=${invite.token}`;
    const inviterName =
      [inviter?.firstName, inviter?.lastName].filter(Boolean).join(" ") ||
      "A WorkSphere teammate";

    const mailResult = await sendCollectionInviteEmail({
      to: invite.email,
      collectionName: access.folder.name,
      inviterName,
      role,
      inviteUrl,
      expiresAt,
    });

    return NextResponse.json(
      {
        mode: "invite_created",
        message: mailResult.sent
          ? "Invitation email sent."
          : "Invitation created. SMTP is not configured, so copy the link manually.",
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
          inviteUrl,
          emailSent: mailResult.sent,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/folders/[id]/invites error:", error);
    return NextResponse.json(
      { error: "Failed to invite teammate" },
      { status: 500 },
    );
  }
}
