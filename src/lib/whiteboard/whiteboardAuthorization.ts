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

export type WhiteboardDenialReason =
  | 'auth_error'
  | 'unauthenticated'
  | 'invalid_room_id'
  | 'not_a_member'
  | 'insufficient_role'
  | 'unknown_operation';

export interface WhiteboardAuditEvent {
  id: string;
  eventType: 'WHITEBOARD_MUTATION_DENIED';
  timestamp: string;
  roomId: string;
  operation: RoomOperationType | string;
  userId: string | null;
  role?: RoomRole;
  isMember?: boolean;
  statusCode: 401 | 403;
  reason: WhiteboardDenialReason;
  message: string;
  requestMethod?: string;
  requestPath?: string;
}

export type WhiteboardAuditListener = (event: WhiteboardAuditEvent) => void;

const MAX_AUDIT_EVENTS = 500;
const auditListeners = new Set<WhiteboardAuditListener>();
const auditEventBuffer: WhiteboardAuditEvent[] = [];
let auditSequence = 0;

/**
 * Registers a listener for whiteboard authorization audit events.
 * Returns an unsubscribe callback.
 */
export function onWhiteboardAuditEvent(listener: WhiteboardAuditListener): () => void {
  auditListeners.add(listener);
  return () => {
    auditListeners.delete(listener);
  };
}

/**
 * Returns recent buffered whiteboard authorization audit events, newest first.
 */
export function getWhiteboardAuditEvents(filter?: {
  roomId?: string;
  userId?: string;
  limit?: number;
}): WhiteboardAuditEvent[] {
  let events = auditEventBuffer;
  if (filter?.roomId) {
    events = events.filter((e) => e.roomId === filter.roomId);
  }
  if (filter?.userId) {
    events = events.filter((e) => e.userId === filter.userId);
  }
  if (typeof filter?.limit === 'number' && filter.limit >= 0) {
    events = events.slice(0, filter.limit);
  }
  return [...events];
}

/**
 * Clears the in-memory whiteboard audit event buffer (primarily for testing).
 */
export function clearWhiteboardAuditEvents(): void {
  auditEventBuffer.length = 0;
}

function createAuditEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  auditSequence += 1;
  return `wb-audit-${Date.now()}-${auditSequence}`;
}

function extractRequestMetadata(request: NextRequest | undefined): {
  requestMethod?: string;
  requestPath?: string;
} {
  if (!request) return {};
  const requestMethod = typeof request.method === 'string' ? request.method : undefined;
  let requestPath: string | undefined;
  if (request.nextUrl && typeof request.nextUrl.pathname === 'string') {
    requestPath = request.nextUrl.pathname;
  } else if (typeof request.url === 'string') {
    try {
      requestPath = new URL(request.url).pathname;
    } catch {
      requestPath = undefined;
    }
  }
  return { requestMethod, requestPath };
}

function emitMutationDeniedAudit(
  request: NextRequest | undefined,
  params: {
    roomId: string;
    operation: RoomOperationType | string;
    userId: string | null;
    role?: RoomRole;
    isMember?: boolean;
    statusCode: 401 | 403;
    reason: WhiteboardDenialReason;
    message: string;
  },
): void {
  const { requestMethod, requestPath } = extractRequestMetadata(request);
  const event: WhiteboardAuditEvent = {
    id: createAuditEventId(),
    eventType: 'WHITEBOARD_MUTATION_DENIED',
    timestamp: new Date().toISOString(),
    roomId: params.roomId,
    operation: params.operation,
    userId: params.userId,
    ...(params.role !== undefined ? { role: params.role } : {}),
    ...(params.isMember !== undefined ? { isMember: params.isMember } : {}),
    statusCode: params.statusCode,
    reason: params.reason,
    message: params.message,
    ...(requestMethod ? { requestMethod } : {}),
    ...(requestPath ? { requestPath } : {}),
  };

  auditEventBuffer.unshift(event);
  if (auditEventBuffer.length > MAX_AUDIT_EVENTS) {
    auditEventBuffer.length = MAX_AUDIT_EVENTS;
  }

  console.warn('[whiteboardAuthorization:audit]', JSON.stringify(event));

  for (const listener of auditListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[whiteboardAuthorization] Audit listener failed:', err);
    }
  }
}

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
  const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';

  const deny = (
    statusCode: 401 | 403,
    error: string,
    reason: WhiteboardDenialReason,
    userId: string | null,
    context?: RoomAuthContext,
  ): RoomAuthorizationResult => {
    if (operation !== 'read') {
      emitMutationDeniedAudit(request, {
        roomId: normalizedRoomId,
        operation,
        userId,
        role: context?.role,
        isMember: context?.isMember,
        statusCode,
        reason,
        message: error,
      });
    }
    return {
      authorized: false,
      statusCode,
      error,
      ...(context ? { context } : {}),
    };
  };

  let userId: string | null = null;

  try {
    const authObj = await auth();
    userId = authObj?.userId ?? null;
  } catch (err) {
    console.error('[whiteboardAuthorization] Clerk auth failure:', err);
    return deny(401, 'Unauthorized: Authentication required', 'auth_error', null);
  }

  if (!userId) {
    return deny(
      401,
      'Unauthorized: No active authentication session',
      'unauthenticated',
      null,
    );
  }

  if (!normalizedRoomId) {
    return deny(403, 'Forbidden: Missing or invalid roomId', 'invalid_room_id', userId);
  }

  const { role, isMember } = await getRoomMembership(userId, normalizedRoomId);
  const context: RoomAuthContext = { userId, role, isMember };

  if (!isMember) {
    return deny(403, 'Forbidden: Access denied to room', 'not_a_member', userId, context);
  }

  // Check role-based capabilities
  if (operation === 'read') {
    // All members can read
    return {
      authorized: true,
      context,
    };
  }

  if (operation === 'write') {
    // Read-only viewers cannot write
    if (role === 'VIEWER') {
      return deny(
        403,
        'Forbidden: Read-only members cannot modify room state',
        'insufficient_role',
        userId,
        context,
      );
    }
    return {
      authorized: true,
      context,
    };
  }

  if (operation === 'delete') {
    // Read-only viewers cannot perform destructive actions.
    if (role === 'VIEWER') {
      return deny(
        403,
        'Forbidden: Read-only members cannot delete room state',
        'insufficient_role',
        userId,
        context,
      );
    }
    // Only OWNER (or authorized editors with delete permissions)
    if (role !== 'OWNER' && role !== 'EDITOR') {
      return deny(
        403,
        'Forbidden: Insufficient privileges for destructive operation',
        'insufficient_role',
        userId,
        context,
      );
    }
    return {
      authorized: true,
      context,
    };
  }

  return deny(403, 'Forbidden: Unknown operation', 'unknown_operation', userId, context);
}
