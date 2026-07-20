import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** How many folder↔venue rows to delete per round inside a transaction. */
const FOLDER_VENUE_DELETE_BATCH = 50;

/** How many times to retry a single batch if Postgres reports a write conflict/deadlock. */
const MAX_RETRIES = 3;

/** Base backoff between retries; grows linearly with attempt number. */
const RETRY_BACKOFF_MS = 50;

function isTransientWriteConflict(error: unknown): boolean {
  // P2034: "Transaction failed due to a write conflict or a deadlock. Please retry your transaction"
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

/**
 * Runs `fn` inside its own short-lived transaction with an explicit isolation
 * level, retrying a bounded number of times if Postgres reports a transient
 * write conflict or deadlock (P2034).
 */
async function runInShortTransaction<T>(
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(fn, {
        maxWait: 5_000,
        timeout: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      attempt += 1;
      if (!isTransientWriteConflict(error) || attempt > MAX_RETRIES) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFF_MS * attempt),
      );
    }
  }
}

export async function hasFolderAccess(folderId: string, userId: string) {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { members: true },
  });

  if (!folder) return { folder: null, hasAccess: false, role: null };

  if (folder.ownerId === userId) {
    return { folder, hasAccess: true, role: "OWNER" };
  }

  const member = folder.members.find((m) => m.userId === userId);
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
 *
 * Each batch of `folderVenue` rows is deleted in its own short transaction
 * rather than one long-held transaction spanning the whole folder. Holding a
 * single transaction open for the full delete (potentially hundreds of rows)
 * keeps a connection checked out of the pool and holds row locks for that
 * entire duration, which is what caused concurrent readers of the same
 * venues to deadlock or time out waiting on the pool. Committing each batch
 * independently releases the connection and locks between batches, and the
 * explicit ReadCommitted isolation level (rather than inheriting whatever
 * the pool/driver default happens to be) keeps batches from unnecessarily
 * conflicting with concurrent reads.
 */
export async function deleteFolderWithRelations(folderId: string) {
  // Batch venue links first — big shared folders can have 100+ rows.
  // Each batch commits on its own so locks aren't held across the whole delete.
  for (;;) {
    const batchSize = await runInShortTransaction(async (tx) => {
      const batch = await tx.folderVenue.findMany({
        where: { folderId },
        select: { id: true },
        take: FOLDER_VENUE_DELETE_BATCH,
      });
      if (batch.length === 0) return 0;

      await tx.folderVenue.deleteMany({
        where: { id: { in: batch.map((row: any) => row.id) } },
      });
      return batch.length;
    });

    if (batchSize === 0) break;
  }

  // Members/upvotes are typically small, but keep them in their own short
  // transaction too rather than folding them into the venue-batch loop.
  await runInShortTransaction(async (tx) => {
    await tx.folderMember.deleteMany({ where: { folderId } });
    await tx.folderUpvote.deleteMany({ where: { folderId } });
  });

  await runInShortTransaction(async (tx) => {
    await tx.folder.delete({ where: { id: folderId } });
  });
}
