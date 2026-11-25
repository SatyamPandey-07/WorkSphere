/**
 * whiteboardAuthorization.ts
 *
 * Implements authentication and room-level authorization policies for collaborative
 * whiteboard operations and snapshot persistence, unifying PartyKit WebSocket and REST access rules.
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
 * Resolves the authenticated user's role and membership in a given room.
 */
export async function getRoomMembership(
  userId: string,
  roomId: string,
): Promise<{ role: RoomRole; isMember: boolean }> {
  const resourceKey = extractResourceKey(roomId);

  try {
    // 1. Check direct folder membership
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
      return { role, isMember: true };
    }

    // 2. Check if the user is the owner of the resource/folder
    const folder = await prisma.folder.findUnique({
      where: { id: resourceKey },
      select: { ownerId: true },
    });

    if (folder && folder.ownerId === userId) {
      return { role: 'OWNER', isMember: true };
    }

    // If folder exists but user is not a member/owner
    if (folder) {
      return { role: 'VIEWER', isMember: false };
    }

    // 3. For custom rooms or ad-hoc whiteboards without a backing Folder record in DB:
    // If the room begins with the user's ID or user has explicit owner tag, treat as OWNER
    if (roomId.includes(userId)) {
      return { role: 'OWNER', isMember: true };
    }

    // Default: real member check required
    return { role: 'VIEWER', isMember: false };
  } catch (err) {
    console.error('[whiteboardAuthorization] Error resolving room membership:', err);
    return { role: 'VIEWER', isMember: false };
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
 * - Destructive operations ('delete'): allowed for OWNER only (or EDITOR depending on room policy;
 *   here strict delete requires OWNER or EDITOR, preventing VIEWER)
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
