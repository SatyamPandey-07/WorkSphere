import { prisma } from "@/lib/prisma";

export async function importCollection(folderId: string, newOwnerId: string) {
  // Deep clone a folder
  const originalFolder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: {
      venues: true,
    },
  });

  if (!originalFolder) {
    throw new Error("Folder not found");
  }

  // Create new folder
  const newFolder = await prisma.folder.create({
    data: {
      name: `${originalFolder.name} (Imported)`,
      description: originalFolder.description,
      ownerId: newOwnerId,
      isPublic: false,
    },
  });

  // Copy venues
  if (originalFolder.venues.length > 0) {
    await prisma.folderVenue.createMany({
      data: originalFolder.venues.map((venue) => ({
        folderId: newFolder.id,
        venueId: venue.venueId,
        addedById: newOwnerId,
      })),
    });
  }

  return newFolder;
}
