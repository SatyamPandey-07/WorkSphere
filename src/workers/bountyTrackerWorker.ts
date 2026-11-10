/**
 * bountyTrackerWorker.ts
 * Web Worker that monitors local IDE activity and Git hooks to track 
 * progress against the bounty parameters off-thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface TrackerMessage {
    type: 'START_TRACKING' | 'LOG_KEYSTROKE' | 'LOG_GIT_EVENT' | 'STOP_TRACKING';
    payload: any;
}

interface SessionState {
    bountyId: string;
    startTime: number;
    activeFocusMs: number;
    lastActivity: number;
    keystrokes: number;
    gitCommits: string[];
    isIdle: boolean;
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of no activity = idle
let activeSession: SessionState | null = null;
let tickInterval: NodeJS.Timeout | null = null;

self.addEventListener('message', (event: MessageEvent<TrackerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'START_TRACKING':
            startSession(payload.bountyId);
            break;
        case 'LOG_KEYSTROKE':
            logActivity();
            break;
        case 'LOG_GIT_EVENT':
            logGitCommit(payload.commitHash);
            break;
        case 'STOP_TRACKING':
            stopSession();
            break;
    }
});

function startSession(bountyId: string) {
    if (activeSession) {
        stopSession();
    }

    activeSession = {
        bountyId,
        startTime: Date.now(),
        activeFocusMs: 0,
        lastActivity: Date.now(),
        keystrokes: 0,
        gitCommits: [],
        isIdle: false
    };

    // Start a 1-second tick to accumulate focus time
    tickInterval = setInterval(() => {
        if (activeSession && !activeSession.isIdle) {
            activeSession.activeFocusMs += 1000;

            // Emit progress update every 10 seconds
            if (activeSession.activeFocusMs % 10000 === 0) {
                self.postMessage({
                    type: 'PROGRESS_UPDATE',
                    bountyId: activeSession.bountyId,
                    focusMinutes: Math.floor(activeSession.activeFocusMs / 60000),
                    keystrokes: activeSession.keystrokes,
                    commits: activeSession.gitCommits.length
                });
            }
        }
    }, 1000);

    self.postMessage({ type: 'SESSION_STARTED', bountyId });
}

function logActivity() {
    if (!activeSession) return;

    const now = Date.now();
    const timeSinceLastActivity = now - activeSession.lastActivity;

    if (timeSinceLastActivity > IDLE_THRESHOLD_MS) {
        // Waking up from idle
        activeSession.isIdle = false;
    }

    activeSession.lastActivity = now;
    activeSession.keystrokes++;

    // Check for idle transition
    if (activeSession.isIdle) {
        activeSession.isIdle = false;
    }
}

function logGitCommit(hash: string) {
    if (!activeSession) return;

    if (!activeSession.gitCommits.includes(hash)) {
        activeSession.gitCommits.push(hash);
        self.postMessage({
            type: 'COMMIT_LOGGED',
            bountyId: activeSession.bountyId,
            hash,
            totalCommits: activeSession.gitCommits.length
        });
    }
}

function stopSession() {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }

    if (activeSession) {
        // Check if the last period was idle
        const timeSinceLastActivity = Date.now() - activeSession.lastActivity;
        if (timeSinceLastActivity > IDLE_THRESHOLD_MS) {
            activeSession.isIdle = true;
        }

        self.postMessage({
            type: 'SESSION_ENDED',
            bountyId: activeSession.bountyId,
            finalStats: {
                totalFocusMinutes: Math.floor(activeSession.activeFocusMs / 60000),
                totalKeystrokes: activeSession.keystrokes,
                totalCommits: activeSession.gitCommits.length,
                commitHashes: activeSession.gitCommits
            }
        });

        activeSession = null;
    }
}

// Background idle checker
setInterval(() => {
    if (activeSession && !activeSession.isIdle) {
        const timeSinceLastActivity = Date.now() - activeSession.lastActivity;
        if (timeSinceLastActivity > IDLE_THRESHOLD_MS) {
            activeSession.isIdle = true;
            self.postMessage({ type: 'IDLE_DETECTED', bountyId: activeSession.bountyId });
        }
    }
}, 10000);

export {};
