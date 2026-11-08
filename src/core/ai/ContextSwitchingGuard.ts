/**
 * ContextSwitchingGuard
 * Manages the application state tree, enforcing strict UI limitations 
 * during active Deep Work sessions to prevent context switching.
 */

import { DeepWorkSession, SessionStatus, ContextRules } from '@/types/deepwork';

export interface UIState {
    showChat: boolean;
    showNotifications: boolean;
    isFullscreen: boolean;
    mapFilter: 'ALL' | 'QUIET_ZONES_ONLY';
    allowTabSwitching: boolean;
}

export class ContextSwitchingGuard {
    private activeSessions: Map<string, DeepWorkSession>;
    private baseUIState: UIState;

    constructor() {
        this.activeSessions = new Map();
        this.baseUIState = {
            showChat: true,
            showNotifications: true,
            isFullscreen: false,
            mapFilter: 'ALL',
            allowTabSwitching: true
        };
    }

    public startSession(session: DeepWorkSession): void {
        this.activeSessions.set(session.sessionId, session);
    }

    public endSession(sessionId: string): void {
        this.activeSessions.delete(sessionId);
    }

    public pauseSession(sessionId: string): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.status = SessionStatus.PAUSED;
            this.activeSessions.set(sessionId, session);
        }
    }

    public getEnforcedUIState(userId: string): UIState {
        // Find the most restrictive active session for this user
        let mostRestrictiveRules: ContextRules | null = null;
        let hasActiveSession = false;

        for (const session of this.activeSessions.values()) {
            if (session.userId === userId && session.status === SessionStatus.ACTIVE) {
                hasActiveSession = true;
                if (!mostRestrictiveRules || session.rules.strictMode) {
                    mostRestrictiveRules = session.rules;
                }
            }
        }

        if (!hasActiveSession || !mostRestrictiveRules) {
            return this.baseUIState;
        }

        return {
            showChat: !mostRestrictiveRules.hideCommunityChat,
            showNotifications: !mostRestrictiveRules.blockSocialNotifications,
            isFullscreen: mostRestrictiveRules.enforceFullscreen,
            mapFilter: mostRestrictiveRules.blockSocialNotifications ? 'QUIET_ZONES_ONLY' : 'ALL',
            allowTabSwitching: !mostRestrictiveRules.strictMode
        };
    }

    public validateAction(userId: string, action: 'SWITCH_TAB' | 'OPEN_CHAT' | 'CANCEL_SESSION'): boolean {
        const state = this.getEnforcedUIState(userId);

        switch (action) {
            case 'SWITCH_TAB':
                return state.allowTabSwitching;
            case 'OPEN_CHAT':
                return state.showChat;
            case 'CANCEL_SESSION':
                // Strict mode requires a "cool-down" or penalty, handled by the API layer
                return true;
            default:
                return true;
        }
    }
}
