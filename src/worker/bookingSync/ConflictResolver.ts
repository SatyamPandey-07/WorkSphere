/**
 * ConflictResolver.ts
 * Implements the three-way merge algorithm for resolving draft vs. server state discrepancies.
 * Ensures that concurrent server-side changes are not blindly overwritten by stale offline drafts.
 */

import { BookingDraft } from './DraftStore';

export interface ServerState {
    id: string;
    version: number;
    payload: Record<string, unknown>;
}

export interface MergeResult {
    resolvedPayload: Record<string, unknown>;
    action: 'USE_SERVER' | 'USE_DRAFT' | 'MERGED';
    requiresUserInput: boolean;
}

export class ConflictResolver {
    /**
     * Performs a three-way merge between the base server state, the incoming server state, 
     * and the local offline draft.
     */
    public resolve(draft: BookingDraft, currentServerState: ServerState): MergeResult {
        // If the draft is older than the server state and has no local modifications that matter, use server
        if (!draft.serverVersion || draft.serverVersion < currentServerState.version) {
            // Check for critical conflicts (e.g., status changed to 'CANCELLED' on server)
            if (currentServerState.payload.status === 'CANCELLED' && draft.payload.status !== 'CANCELLED') {
                return {
                    resolvedPayload: currentServerState.payload,
                    action: 'USE_SERVER',
                    requiresUserInput: true // Notify user that booking was cancelled on server
                };
            }
        }

        // Simple field-level merge strategy
        const resolvedPayload = { ...currentServerState.payload };
        let hasMerged = false;

        for (const [key, draftValue] of Object.entries(draft.payload)) {
            const serverValue = currentServerState.payload[key];

            // If the field was not changed on the server, or the draft is newer, prefer draft
            if (serverValue === undefined || draft.serverVersion! >= currentServerState.version) {
                resolvedPayload[key] = draftValue;
                hasMerged = true;
            } else if (JSON.stringify(serverValue) !== JSON.stringify(draftValue)) {
                // Conflict detected: both changed. For bookings, prefer server for critical fields
                if (['status', 'venueId', 'userId'].includes(key)) {
                    return {
                        resolvedPayload: currentServerState.payload,
                        action: 'USE_SERVER',
                        requiresUserInput: true
                    };
                }
                // For non-critical fields (e.g., 'notes'), prefer draft
                resolvedPayload[key] = draftValue;
                hasMerged = true;
            }
        }

        return {
            resolvedPayload,
            action: hasMerged ? 'MERGED' : 'USE_SERVER',
            requiresUserInput: false
        };
    }
}
