-- CreateIndex
CREATE INDEX "Folder_isPublic_upvotes_createdAt_id_idx" ON "Folder"("isPublic", "upvotes" DESC, "createdAt" DESC, "id" DESC);
