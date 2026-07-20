import { prisma } from "@/lib/prisma";

/** How many folder↔venue rows to delete per round inside the transaction. */
const FOLDER_VENUE_DELETE_BATCH = 50;

export async function hasFolderAccess(folderId: string, userId: string) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { members: true },
  });

  if (!folder) return { folder: null, hasAccess: false, role: null };

  if (folder.ownerId === userId) {
    return { folder, hasAccess: true, role: "OWNER" };
  }

  const member = folder.members.find(m => m.userId === userId);
  if (member) {
    return { folder, hasAccess: true, role: member.role };
  }

  // Public collections are accessible to any user as dynamic read-only views
  if ((folder as any).isPublic) {
    return { folder, hasAccess: true, role: "VIEWER" };
  }

  return { folder, hasAccess: false, role: null };
}

/**
 * Deletes a folder and its related rows without relying on a single cascade
 * wipe (which can exhaust the pool on large shared collections).
 */
export async function deleteFolderWithRelations(folderId: string) {
  await prisma.$transaction(
    async (tx) => {
      // Batch venue links first — big shared folders can have 100+ rows.
      for (;;) {
        const batch = await tx.folderVenue.findMany({
          where: { folderId },
          select: { id: true },
          take: FOLDER_VENUE_DELETE_BATCH,
        });
        if (batch.length === 0) break;

        await tx.folderVenue.deleteMany({
          where: { id: { in: batch.map((row) => row.id) } },
        });
      }

      await tx.folderMember.deleteMany({ where: { folderId } });
      await tx.folderUpvote.deleteMany({ where: { folderId } });
      await tx.folder.delete({ where: { id: folderId } });
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}
