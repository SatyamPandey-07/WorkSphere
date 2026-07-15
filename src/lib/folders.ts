import { prisma } from "@/lib/prisma";

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
