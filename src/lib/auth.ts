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
    return await prisma.user.create({
        data: {
            id: user.id,
            email: user.emailAddresses[0]?.emailAddress,
            firstName: user.firstName,
            lastName: user.lastName,
        },
    });
}
