import { NextRequest } from 'next/server';
import {
  whiteboardAuthCache,
  invalidateCollaboratorAuthCache,
  removeCollaboratorAndInvalidate,
  getRoomMembership,
  authorizeRoomOperation,
  RoomRole,
} from '@/lib/whiteboard/whiteboardAuthorization';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    folderMember: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    folder: {
      findUnique: jest.fn(),
    },
  },
}));

describe('Whiteboard Authorization Cache Invalidation Synchronization (#10462)', () => {
  const FOLDER_ID = 'folder-uuid-101';
  const ROOM_ID = `folder-notes-${FOLDER_ID}`;
  const COLLABORATOR_ID = 'user-collaborator-1';
  const UNRELATED_USER_ID = 'user-unrelated-2';
  const UNRELATED_ROOM_ID = 'folder-notes-unrelated-folder';

  beforeEach(() => {
    jest.clearAllMocks();
    whiteboardAuthCache.clear();
  });

  describe('1. Invalidation when collaborator is removed', () => {
    it('invalidates the cached authorization entry for the removed collaborator', () => {
      // Seed cache
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).not.toBeNull();

      const result = invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);

      expect(result.invalidated).toBe(true);
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).toBeNull();
    });

    it('synchronously evicts cache and deletes membership via removeCollaboratorAndInvalidate', async () => {
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });
      (prisma.folderMember.delete as jest.Mock).mockResolvedValue({
        folderId: FOLDER_ID,
        userId: COLLABORATOR_ID,
      });

      const res = await removeCollaboratorAndInvalidate(ROOM_ID, COLLABORATOR_ID);

      expect(res.success).toBe(true);
      expect(res.invalidated).toBe(true);
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).toBeNull();
      expect(prisma.folderMember.delete).toHaveBeenCalledWith({
        where: {
          folderId_userId: {
            folderId: FOLDER_ID,
            userId: COLLABORATOR_ID,
          },
        },
      });
    });
  });

  describe('2. Prevention of stale cached access permissions', () => {
    it('prevents removed collaborator from retaining write permission immediately after removal', async () => {
      // 1. Initial state: Collaborator has EDITOR role in DB and populates cache
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        folderId: FOLDER_ID,
        userId: COLLABORATOR_ID,
        role: 'EDITOR',
      });
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: COLLABORATOR_ID });

      const req = new NextRequest(`http://localhost/api/whiteboard?roomId=${ROOM_ID}`);
      const initialAuth = await authorizeRoomOperation(req, ROOM_ID, 'write');
      expect(initialAuth.authorized).toBe(true);

      // Verify cached
      const cached = whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID);
      expect(cached).not.toBeNull();
      expect(cached?.role).toBe('EDITOR');

      // 2. Collaborator is removed from database
      (prisma.folderMember.delete as jest.Mock).mockResolvedValue({});
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'other-owner' });

      // Action: Invalidation occurs
      await removeCollaboratorAndInvalidate(ROOM_ID, COLLABORATOR_ID);

      // 3. Immediate check afterwards must deny permission (not return stale EDITOR role)
      const postRemovalAuth = await authorizeRoomOperation(req, ROOM_ID, 'write');
      expect(postRemovalAuth.authorized).toBe(false);
      expect(postRemovalAuth.statusCode).toBe(403);
      expect(postRemovalAuth.error).toContain('Access denied');
    });

    it('prevents removed collaborator from retaining read permission', async () => {
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        folderId: FOLDER_ID,
        userId: COLLABORATOR_ID,
        role: 'VIEWER',
      });
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: COLLABORATOR_ID });

      const req = new NextRequest(`http://localhost/api/whiteboard?roomId=${ROOM_ID}`);
      const initialAuth = await authorizeRoomOperation(req, ROOM_ID, 'read');
      expect(initialAuth.authorized).toBe(true);

      // Remove and invalidate
      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.folder.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'other-owner' });
      invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);

      const postRemovalAuth = await authorizeRoomOperation(req, ROOM_ID, 'read');
      expect(postRemovalAuth.authorized).toBe(false);
      expect(postRemovalAuth.statusCode).toBe(403);
    });
  });

  describe('3. Unrelated cache preservation', () => {
    it('preserves cached permissions for unrelated users in the same room', () => {
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });
      whiteboardAuthCache.set(UNRELATED_USER_ID, ROOM_ID, { role: 'VIEWER', isMember: true });

      invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);

      // Target user is evicted
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).toBeNull();
      // Unrelated user in the same room is untouched
      const unrelatedEntry = whiteboardAuthCache.get(UNRELATED_USER_ID, ROOM_ID);
      expect(unrelatedEntry).not.toBeNull();
      expect(unrelatedEntry?.role).toBe('VIEWER');
    });

    it('preserves cached permissions for the same user in an unrelated whiteboard', () => {
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });
      whiteboardAuthCache.set(COLLABORATOR_ID, UNRELATED_ROOM_ID, { role: 'EDITOR', isMember: true });

      invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);

      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).toBeNull();
      const unrelatedRoomEntry = whiteboardAuthCache.get(COLLABORATOR_ID, UNRELATED_ROOM_ID);
      expect(unrelatedRoomEntry).not.toBeNull();
      expect(unrelatedRoomEntry?.role).toBe('EDITOR');
    });
  });

  describe('4. Repeated removal and missing cache entry handling', () => {
    it('handles repeated cache invalidation safely without throwing', () => {
      // First invalidation when not in cache
      const first = invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);
      expect(first.invalidated).toBe(false);

      // Seed cache
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'VIEWER', isMember: true });

      // Second invalidation (evicts entry)
      const second = invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);
      expect(second.invalidated).toBe(true);

      // Third invalidation (already evicted, safe no-op)
      const third = invalidateCollaboratorAuthCache(COLLABORATOR_ID, ROOM_ID);
      expect(third.invalidated).toBe(false);
    });

    it('handles repeated removeCollaboratorAndInvalidate gracefully when Prisma returns P2025', async () => {
      (prisma.folderMember.delete as jest.Mock).mockRejectedValue({ code: 'P2025' });

      const res = await removeCollaboratorAndInvalidate(ROOM_ID, COLLABORATOR_ID);

      expect(res.success).toBe(true);
      expect(res.error).toBe('Member was already removed or does not exist');
    });

    it('handles empty or malformed arguments safely', () => {
      const res = invalidateCollaboratorAuthCache('', '');
      expect(res.invalidated).toBe(false);
      expect(res.cacheKey).toBe('');
    });
  });

  describe('5. Consistent cache synchronization across operations', () => {
    it('normalizes room prefixes so invalidating folderId invalidates folder-notes-${id}', () => {
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });

      // Invalidate using raw FOLDER_ID
      const res = invalidateCollaboratorAuthCache(COLLABORATOR_ID, FOLDER_ID);
      expect(res.invalidated).toBe(true);

      // Verify that lookup via ROOM_ID is also evicted
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)).toBeNull();
    });

    it('supports bypassing cache explicitly with bypassCache flag', async () => {
      whiteboardAuthCache.set(COLLABORATOR_ID, ROOM_ID, { role: 'EDITOR', isMember: true });

      (prisma.folderMember.findUnique as jest.Mock).mockResolvedValue({
        folderId: FOLDER_ID,
        userId: COLLABORATOR_ID,
        role: 'VIEWER', // Updated role in DB
      });

      // Normal read uses cache
      const cachedResult = await getRoomMembership(COLLABORATOR_ID, ROOM_ID);
      expect(cachedResult.role).toBe('EDITOR');

      // Bypassed read fetches updated DB value and updates cache
      const freshResult = await getRoomMembership(COLLABORATOR_ID, ROOM_ID, true);
      expect(freshResult.role).toBe('VIEWER');
      expect(whiteboardAuthCache.get(COLLABORATOR_ID, ROOM_ID)?.role).toBe('VIEWER');
    });
  });
});
