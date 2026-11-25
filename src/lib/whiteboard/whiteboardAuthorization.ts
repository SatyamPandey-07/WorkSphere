/**
 * whiteboardAuthorization.ts
 *
 * Implements authentication, room-level authorization policies, and synchronized
 * caching/invalidation for collaborative whiteboard operations and snapshot persistence.
 *
 * Cache Invalidation Architecture (#10462):
 * - To minimize latency during high-frequency CRDT synchronization and REST operations,
 *   resolved room memberships and authorization decisions may be cached with a finite TTL.
 * - However, when a collaborator is removed or their role changes, cached authorizations
 *   can lead to stale access windows where a removed collaborator retains unauthorized access.
 * - `invalidateCollaboratorAuthCache(userId, roomId)` and `removeCollaboratorAndInvalidate(folderId, userId)`
 *   synchronously evict cached entries for the specific collaborator-room pair (and normalized resource key).
 * - Read, write, and delete permission checks consult the cache when valid, and immediately reflect
 *   cache evictions by querying source-of-truth storage upon removal.
 * - Cache isolation ensures that invalidating one collaborator's permissions never affects
 *   unrelated users or different whiteboards.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import type { NextRequest } from 'next/server';

export type RoomRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type RoomOperationType = 'read' | 'write' | 'delete';

export interface RoomAuthContext {
  userId: string;
  role: RoomRole;
  isMember: boolean;
}

export interface RoomAuthorizationResult {
  authorized: boolean;
  statusCode?: 401 | 403;
  error?: string;
  context?: RoomAuthContext;
}

export interface CachedAuthEntry {
  userId: string;
  roomId: string;
  resourceKey: string;
  role: RoomRole;
  isMember: boolean;
  cachedAt: number;
  expiresAt: number;
}

/** Default cache TTL: 5 minutes in milliseconds */
export const DEFAULT_AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory authorization cache: Map<cacheKey, CachedAuthEntry>
 * Key structure: `${userId}::${resourceKey}`
 */
class WhiteboardAuthorizationCache {
  private cache = new Map<string, CachedAuthEntry>();
  private defaultTtlMs: number;

  constructor(ttlMs: number = DEFAULT_AUTH_CACHE_TTL_MS) {
    this.defaultTtlMs = ttlMs;
  }

  /**
   * Generates a stable normalized cache key from userId and normalized roomId/resourceKey.
   */
  public getCacheKey(userId: string, roomIdOrResourceKey: string): string {
    const normalizedKey = extractResourceKey(roomIdOrResourceKey.trim());
    return `${userId.trim()}::${normalizedKey}`;
  }

  /**
   * Retrieves a cached authorization entry if it exists and has not expired.
   */
  public get(userId: string, roomIdOrResourceKey: string): CachedAuthEntry | null {
    if (!userId || !roomIdOrResourceKey) return null;
    const key = this.getCacheKey(userId, roomIdOrResourceKey);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * Caches an authorization decision for a user and room.
   */
  public set(
    userId: string,
    roomIdOrResourceKey: string,
    membership: { role: RoomRole; isMember: boolean },
    ttlMs: number = this.defaultTtlMs,
  ): void {
    if (!userId || !roomIdOrResourceKey) return;
    const key = this.getCacheKey(userId, roomIdOrResourceKey);
    const resourceKey = extractResourceKey(roomIdOrResourceKey.trim());
    const now = Date.now();
    this.cache.set(key, {
      userId: userId.trim(),
      roomId: roomIdOrResourceKey.trim(),
      resourceKey,
      role: membership.role,
      isMember: membership.isMember,
      cachedAt: now,
      expiresAt: now + ttlMs,
    });
  }

  /**
   * Synchronously invalidates cached authorization for a specific collaborator and room.
   * Handles non-existent keys safely (no-op).
   * Ensures unrelated users or whiteboards are preserved.
   *
   * @returns true if an active cache entry was deleted, false otherwise.
   */
  public invalidate(userId: string, roomIdOrResourceKey: string): boolean {
    if (!userId || !roomIdOrResourceKey) return false;
    const key = this.getCacheKey(userId, roomIdOrResourceKey);
    return this.cache.delete(key);
  }

  /**
   * Invalidates all cached entries for a given user across all rooms (e.g., account suspension/deletion).
   */
  public invalidateUser(userId: string): number {
    if (!userId) return 0;
    const trimmedId = userId.trim();
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.userId === trimmedId) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidates all cached entries for a given whiteboard/room across all users.
   */
  public invalidateRoom(roomIdOrResourceKey: string): number {
    if (!roomIdOrResourceKey) return 0;
    const resourceKey = extractResourceKey(roomIdOrResourceKey.trim());
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.resourceKey === resourceKey) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Returns current count of cached entries.
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * Clears the entire authorization cache (useful for testing and system resets).
   */
  public clear(): void {
    this.cache.clear();
  }
}

/** Global singleton authorization cache instance */
export const whiteboardAuthCache = new WhiteboardAuthorizationCache();

/**
 * Maps a generic roomId to its underlying folderId / workspaceId if structured as
 * `folder-notes-${id}`, `folder-${id}`, `whiteboard-${id}`, or a direct ID.
 */
export function extractResourceKey(roomId: string): string {
  if (!roomId) return '';
  if (roomId.startsWith('folder-notes-')) {
    return roomId.replace('folder-notes-', '');
  }
  if (roomId.startsWith('folder-')) {
    return roomId.replace('folder-', '');
  }
  if (roomId.startsWith('whiteboard-')) {
    return roomId.replace('whiteboard-', '');
  }
  return roomId;
}

/**
 * Invalidates authorization cache entries when a collaborator is removed or updated.
 *
 * Guarantees:
 * 1. Safe handling of missing cache entries or repeated removal calls.
 * 2. Unrelated users' and rooms' cached permissions are unaffected.
 * 3. Future checks for (userId, roomId) query the source of truth immediately.
 */
export function invalidateCollaboratorAuthCache(
  userId: string,
  roomIdOrResourceKey: string,
): { invalidated: boolean; cacheKey: string } {
  if (!userId || !roomIdOrResourceKey) {
    return { invalidated: false, cacheKey: '' };
  }
  const cacheKey = whiteboardAuthCache.getCacheKey(userId, roomIdOrResourceKey);
  const invalidated = whiteboardAuthCache.invalidate(userId, roomIdOrResourceKey);
  return { invalidated, cacheKey };
}

/**
 * Resolves the authenticated user's role and membership in a given room.
 *
 * Implements cached reads:
 * 1. Checks memory cache for warm, unexpired membership info.
 * 2. On cache miss or eviction, queries database (prisma) for folder membership or owner record.
 * 3. Populates the cache upon resolution for subsequent fast checks.
 *
 * @param userId - ID of the user
 * @param roomId - Identifier of the room
 * @param bypassCache - Optional flag to bypass cache and force database lookup
 */
export async function getRoomMembership(
  userId: string,
  roomId: string,
  bypassCache = false,
): Promise<{ role: RoomRole; isMember: boolean }> {
  if (!userId || !roomId) {
    return { role: 'VIEWER', isMember: false };
  }

  // 1. Check cache first unless explicitly bypassed
  if (!bypassCache) {
    const cached = whiteboardAuthCache.get(userId, roomId);
    if (cached) {
      return { role: cached.role, isMember: cached.isMember };
    }
  }

  const resourceKey = extractResourceKey(roomId);

  try {
    // 2. Check direct folder membership
    const membership = await prisma.folderMember.findUnique({
      where: {
        folderId_userId: {
          folderId: resourceKey,
          userId,
        },
      },
    });

    if (membership) {
      const role: RoomRole =
        membership.role === 'OWNER'
          ? 'OWNER'
          : membership.role === 'EDITOR'
          ? 'EDITOR'
          : 'VIEWER';
      const resolved = { role, isMember: true };
      whiteboardAuthCache.set(userId, roomId, resolved);
      return resolved;
    }

    // 3. Check if the user is the owner of the resource/folder
    const folder = await prisma.folder.findUnique({
      where: { id: resourceKey },
      select: { ownerId: true },
    });

    if (folder && folder.ownerId === userId) {
      const resolved = { role: 'OWNER' as RoomRole, isMember: true };
      whiteboardAuthCache.set(userId, roomId, resolved);
      return resolved;
    }

    // If folder exists but user is not a member/owner
    if (folder) {
      const resolved = { role: 'VIEWER' as RoomRole, isMember: false };
      whiteboardAuthCache.set(userId, roomId, resolved);
      return resolved;
    }

    // 4. For custom rooms or ad-hoc whiteboards without a backing Folder record in DB:
    if (roomId.includes(userId)) {
      const resolved = { role: 'OWNER' as RoomRole, isMember: true };
      whiteboardAuthCache.set(userId, roomId, resolved);
      return resolved;
    }

    // Default: real member check required
    const resolved = { role: 'VIEWER' as RoomRole, isMember: false };
    whiteboardAuthCache.set(userId, roomId, resolved);
    return resolved;
  } catch (err) {
    console.error('[whiteboardAuthorization] Error resolving room membership:', err);
    return { role: 'VIEWER', isMember: false };
  }
}

/**
 * Removes a collaborator from a folder/whiteboard and synchronizes cache invalidation.
 *
 * This operation:
 * 1. Deletes the membership record from the database (prisma.folderMember.delete).
 * 2. Immediately evicts the authorization cache for that user and room.
 * 3. Prevents removed collaborators from retaining stale cached access permissions.
 * 4. Handles repeated removal calls safely (catching P2025 record-not-found).
 */
export async function removeCollaboratorAndInvalidate(
  folderIdOrRoomId: string,
  collaboratorUserId: string,
): Promise<{ success: boolean; invalidated: boolean; error?: string }> {
  const resourceKey = extractResourceKey(folderIdOrRoomId);

  // Invalidate cache immediately regardless of DB existence to ensure no stale permission lingers
  const { invalidated } = invalidateCollaboratorAuthCache(collaboratorUserId, resourceKey);

  try {
    await prisma.folderMember.delete({
      where: {
        folderId_userId: {
          folderId: resourceKey,
          userId: collaboratorUserId,
        },
      },
    });

    return { success: true, invalidated };
  } catch (error: any) {
    // Prisma P2025: Record to delete does not exist (e.g. repeated removal)
    if (error?.code === 'P2025') {
      return { success: true, invalidated, error: 'Member was already removed or does not exist' };
    }

    console.error('[whiteboardAuthorization] Error removing collaborator:', error);
    return {
      success: false,
      invalidated,
      error: error?.message || 'Failed to remove collaborator',
    };
  }
}

/**
 * Enforces room-level authorization for an authenticated user and operation.
 *
 * Rules:
 * - Unauthenticated -> 401 Unauthorized
 * - Non-member / unauthorized room -> 403 Forbidden
 * - Read operations ('read'): allowed for OWNER, EDITOR, and VIEWER (as long as isMember is true)
 * - Write operations ('write'): allowed for OWNER and EDITOR only
 * - Destructive operations ('delete'): allowed for OWNER and EDITOR only, preventing VIEWER
 */
export async function authorizeRoomOperation(
  request: NextRequest,
  roomId: string,
  operation: RoomOperationType,
): Promise<RoomAuthorizationResult> {
  let userId: string | null = null;

  try {
    const authObj = await auth();
    userId = authObj?.userId ?? null;
  } catch (err) {
    console.error('[whiteboardAuthorization] Clerk auth failure:', err);
    return {
      authorized: false,
      statusCode: 401,
      error: 'Unauthorized: Authentication required',
    };
  }

  if (!userId) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Unauthorized: No active authentication session',
    };
  }

  if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Missing or invalid roomId',
    };
  }

  const { role, isMember } = await getRoomMembership(userId, roomId.trim());

  if (!isMember) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Access denied to room',
      context: { userId, role, isMember },
    };
  }

  // Check role-based capabilities
  if (operation === 'read') {
    // All members can read
    return {
      authorized: true,
      context: { userId, role, isMember },
    };
  }

  if (operation === 'write') {
    // Read-only viewers cannot write
    if (role === 'VIEWER') {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Forbidden: Read-only members cannot modify room state',
        context: { userId, role, isMember },
      };
    }
    return {
      authorized: true,
      context: { userId, role, isMember },
    };
  }

  if (operation === 'delete') {
    // Read-only viewers cannot perform destructive actions.
    if (role === 'VIEWER') {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Forbidden: Read-only members cannot delete room state',
        context: { userId, role, isMember },
      };
    }
    // Only OWNER (or authorized editors with delete permissions)
    if (role !== 'OWNER' && role !== 'EDITOR') {
      return {
        authorized: false,
        statusCode: 403,
        error: 'Forbidden: Insufficient privileges for destructive operation',
        context: { userId, role, isMember },
      };
    }
    return {
      authorized: true,
      context: { userId, role, isMember },
    };
  }

  return {
    authorized: false,
    statusCode: 403,
    error: 'Forbidden: Unknown operation',
  };
}
