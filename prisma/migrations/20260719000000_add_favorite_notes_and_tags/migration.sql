-- AlterTable: Add notes and updatedAt to Favorite
ALTER TABLE "Favorite" ADD COLUMN "notes" TEXT;
ALTER TABLE "Favorite" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "FavoriteTag" (
    "id" TEXT NOT NULL,
    "favoriteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoriteTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteTag_favoriteId_name_key" ON "FavoriteTag"("favoriteId", "name");

-- CreateIndex
CREATE INDEX "FavoriteTag_favoriteId_idx" ON "FavoriteTag"("favoriteId");

-- AddForeignKey
ALTER TABLE "FavoriteTag" ADD CONSTRAINT "FavoriteTag_favoriteId_fkey" FOREIGN KEY ("favoriteId") REFERENCES "Favorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
