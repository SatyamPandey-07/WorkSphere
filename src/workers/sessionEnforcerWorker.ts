/**
 * Session Enforcer Worker
 * Monitors browser focus, visibility, and idle time to automatically 
 * extend or pause Deep Work sessions based on user engagement.
 */

export interface EnforcerConfig {
    maxIdleTimeMs: number; // e.g., 300000 (5 mins)
    autoPauseOnBlur: boolean;
    autoExtendOnFocus: boolean;
    maxExtensions: number;
}

interface SessionState {
    sessionId: string;
    lastActivity: number;
    extensionsUsed: number;
    isPaused: boolean;
}

const sessions = new Map<string, SessionState>();
let config: EnforcerConfig = {
    maxIdleTimeMs: 300000,
    autoPauseOnBlur: true,
    autoExtendOnFocus: true,
    maxExtensions: 3
};

let checkInterval: any = null;

self.addEventListener('message', (event: MessageEvent) => {
    const { action, payload } = event.data;

    switch (action) {
        case 'INIT':
            config = { ...config, ...payload };
            startMonitoring();
            break;
        case 'REGISTER_SESSION':
            sessions.set(payload.sessionId, {
                sessionId: payload.sessionId,
                lastActivity: Date.now(),
                extensionsUsed: 0,
                isPaused: false
            });
            break;
        case 'USER_ACTIVITY':
            handleActivity(payload.sessionId);
            break;
        case 'VISIBILITY_CHANGE':
            handleVisibility(payload.hidden, payload.sessionId);
            break;
        case 'STOP':
            stopMonitoring();
            break;
    }
});

function startMonitoring() {
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, state] of sessions.entries()) {
            if (state.isPaused) continue;

            const idleTime = now - state.lastActivity;
            if (idleTime > config.maxIdleTimeMs) {
                // Auto-pause due to inactivity
                state.isPaused = true;
                self.postMessage({ action: 'SESSION_PAUSED', sessionId: id, reason: 'IDLE_TIMEOUT' });
            }
        }
    }, 10000); // Check every 10 seconds
}

function stopMonitoring() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
    sessions.clear();
}

function handleActivity(sessionId: string) {
    const state = sessions.get(sessionId);
    if (!state) return;

    state.lastActivity = Date.now();

    // If it was paused due to idle, and we allow auto-resume (not implemented here for strictness, but noted)
    if (state.isPaused) {
        // In strict mode, manual resume is required. 
        // We just update the timestamp so it doesn't trigger again immediately if resumed.
    }
}

function handleVisibility(hidden: boolean, sessionId: string) {
    const state = sessions.get(sessionId);
    if (!state || !config.autoPauseOnBlur) return;

    if (hidden && !state.isPaused) {
        state.isPaused = true;
        self.postMessage({ action: 'SESSION_PAUSED', sessionId, reason: 'TAB_BLUR' });
    } else if (!hidden && state.isPaused) {
        // We don't auto-resume on focus to prevent accidental context switching.
        // User must explicitly click "Resume Deep Work".
        self.postMessage({ action: 'REQUIRES_MANUAL_RESUME', sessionId });
    }
}

export { };
