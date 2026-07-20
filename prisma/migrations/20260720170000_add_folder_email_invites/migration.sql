CREATE TYPE "FolderInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "FolderInvite" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "FolderRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "status" "FolderInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FolderInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FolderInvite_token_key" ON "FolderInvite"("token");
CREATE INDEX "FolderInvite_folderId_idx" ON "FolderInvite"("folderId");
CREATE INDEX "FolderInvite_email_idx" ON "FolderInvite"("email");
CREATE INDEX "FolderInvite_status_expiresAt_idx" ON "FolderInvite"("status", "expiresAt");

ALTER TABLE "FolderInvite" ADD CONSTRAINT "FolderInvite_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderInvite" ADD CONSTRAINT "FolderInvite_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
