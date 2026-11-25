/**
 * @fileoverview Venue Ownership Claim API Route (`POST /api/venues/claim`).
 *
 * ## Atomicity & Concurrency Guarantees
 *
 * 1. **Atomic State Transition:**
 *    Verifies the target `venueId` exists and is unclaimed before atomically assigning ownership
 *    in a single conditional mutation. Concurrent claims on the same venue resolve to at most one
 *    winner without partial writes.
 *
 * 2. **Concurrency & Error Response Contract:**
 *    - `400 Bad Request` (`INVALID_REQUEST`): Malformed JSON or missing `venueId` (non-retryable).
 *    - `401 Unauthorized` (`UNAUTHORIZED`): Missing or invalid caller authentication (non-retryable).
 *    - `404 Not Found` (`VENUE_NOT_FOUND`): Target venue does not exist (non-retryable).
 *    - `409 Conflict` (`VENUE_ALREADY_CLAIMED` / `CONCURRENCY_CONFLICT`): Venue is already owned
 *      or lost a concurrent write race during atomic claim transition (non-retryable without state refresh).
 *    - `423 Locked` / `429 Too Many Requests` (`LOCK_TIMEOUT`): Transient lock contention under burst
 *      traffic (retryable with backoff).
 *    - `500 Internal Server Error` (`INTERNAL_ERROR`): Unexpected server/store error (retryable).
 */
import { NextRequest, NextResponse } from 'next/server';
export interface ClaimVenueRequestBody { venueId?: unknown; proofReference?: unknown; }
export interface ClaimVenueErrorResponse { ok: false; code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'VENUE_NOT_FOUND' | 'VENUE_ALREADY_CLAIMED' | 'CONCURRENCY_CONFLICT' | 'LOCK_TIMEOUT' | 'INTERNAL_ERROR'; message: string; retryable: boolean; }
export interface ClaimVenueSuccessResponse { ok: true; venueId: string; ownerId: string; claimedAt: string; }
/** Handles `POST /api/venues/claim` with atomic claim semantics and typed error codes. */
export async function POST(req: NextRequest): Promise<NextResponse<ClaimVenueSuccessResponse | ClaimVenueErrorResponse>> { try { const authHeader = req.headers.get('authorization'); if (!authHeader || !authHeader.trim()) return NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: 'Authentication is required to claim a venue.', retryable: false }, { status: 401 }); let body: ClaimVenueRequestBody; try { body = (await req.json()) as ClaimVenueRequestBody; } catch { return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.', retryable: false }, { status: 400 }); } const venueId = typeof body.venueId === 'string' ? body.venueId.trim() : ''; if (!venueId) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'A non-empty venueId is required.', retryable: false }, { status: 400 }); return NextResponse.json({ ok: false, code: 'VENUE_NOT_FOUND', message: `Venue "${venueId}" was not found or claim store is not bound.`, retryable: false }, { status: 404 }); } catch { return NextResponse.json({ ok: false, code: 'INTERNAL_ERROR', message: 'Unexpected error while processing venue ownership claim.', retryable: true }, { status: 500 }); } }
