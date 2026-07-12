"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

async function verifyAdmin() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    throw new Error("Forbidden: Admins only");
  }

  return userId;
}

export async function getPendingFlags() {
  await verifyAdmin();

  const flags = await prisma.flaggedItem.findMany({
    where: { status: "PENDING" },
    include: {
      reportedBy: {
        select: { firstName: true, lastName: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // We fetch related items manually because Prisma polymorphic relations aren't native
  const enhancedFlags = await Promise.all(
    flags.map(async (flag) => {
      let details = null;
      if (flag.type === "VENUE") {
        details = await prisma.venue.findUnique({
          where: { id: flag.itemId },
          select: { name: true, category: true, address: true },
        });
      } else if (flag.type === "REVIEW") {
        details = await prisma.venueRating.findUnique({
          where: { id: flag.itemId },
          select: { comment: true, wifiQuality: true, venue: { select: { name: true } } },
        });
      }

      return {
        ...flag,
        itemDetails: details,
      };
    })
  );

  return enhancedFlags;
}

export async function dismissFlag(flagId: string) {
  const adminId = await verifyAdmin();

  const flag = await prisma.flaggedItem.update({
    where: { id: flagId },
    data: { status: "DISMISSED" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "DISMISS_FLAG",
      entityType: "FlaggedItem",
      entityId: flagId,
    },
  });

  revalidatePath("/admin/feedback");
  return flag;
}

export async function deleteFlaggedItem(flagId: string) {
  const adminId = await verifyAdmin();

  const flag = await prisma.flaggedItem.findUnique({
    where: { id: flagId },
  });

  if (!flag) throw new Error("Flag not found");

  if (flag.type === "REVIEW") {
    // Delete the review
    await prisma.venueRating.delete({
      where: { id: flag.itemId },
    });
  } else if (flag.type === "VENUE") {
    // Delete the venue
    await prisma.venue.delete({
      where: { id: flag.itemId },
    });
  }

  await prisma.flaggedItem.update({
    where: { id: flagId },
    data: { status: "RESOLVED" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: `DELETE_${flag.type}`,
      entityType: "FlaggedItem",
      entityId: flagId,
      details: JSON.stringify({ itemIdDeleted: flag.itemId }),
    },
  });

  revalidatePath("/admin/feedback");
  return { success: true };
}
