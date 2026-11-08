import { prisma } from "./prisma";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Ensures a user exists in the local database.
 * This is a safety protocol for environments where webhooks might be delayed or inactive.
 * 💎🛡️✨
 */
export async function ensureUserExists(userId: string) {
  if (!userId) return null;

  // 1. Check local ledger
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (existingUser) return existingUser;

  // 2. Retrieve from Clerk if missing
  const user = await currentUser();
  if (!user || user.id !== userId) {
    // Fallback search if currentUser() is inconsistent
    return null;
  }

  // 3. Persist to local database
  const initials =
    `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase();
  const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials || "WS")}&background=6366f1&color=fff`;

  const imageUrl = user.imageUrl
    ? user.imageUrl
        .replace(/(\?|&)sz=\d+/, "$1sz=150")
        .replace(/(\?|&)width=\d+/, "$1width=150")
    : fallbackUrl;

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  // Upsert so concurrent first requests from a new user can't race on create.
  try {
    return await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        email,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl,
      },
    });
  } catch (err: any) {
    // Email is unique: a stale row may hold it (e.g. a deleted Clerk account
    // re-registered). Keep the user usable rather than failing the request.
    if (err?.code === "P2002") {
      return await prisma.user.upsert({
        where: { id: user.id },
        update: {},
        create: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          imageUrl,
        },
      });
    }
    throw err;
  }
}
