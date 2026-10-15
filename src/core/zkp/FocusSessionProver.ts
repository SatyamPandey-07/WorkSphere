/**
 * FocusSessionProver.ts
 * Manages the collection of local telemetry (app focus time, keystroke cadence) 
 * and formats it for the ZK prover.
 */

import { FocusWitness, PublicInputs } from './DeepWorkCircuit';

export interface TelemetryEvent {
    timestamp: number;
    type: 'focus_start' | 'focus_end' | 'input_keystroke' | 'input_mouse';
    appName?: string;
}

export class FocusSessionProver {
    private events: TelemetryEvent[] = [];
    private sessionStartTime: number | null = null;
    private readonly ALLOWED_APPS = ['vscode', 'chrome', 'figma', 'notion', 'terminal'];

    constructor() { }

    /**
     * Starts a new deep work tracking session.
     */
    public startSession(): string {
        this.sessionStartTime = Date.now();
        this.events = [];
        this.logEvent({ timestamp: this.sessionStartTime, type: 'focus_start', appName: 'system' });
        return this.generateSessionId();
    }

    /**
     * Logs a telemetry event from the browser's Page Visibility API and input listeners.
     */
    public logEvent(event: TelemetryEvent): void {
        if (!this.sessionStartTime) return;

        // Filter out events from non-productive apps if app name is provided
        if (event.appName && !this.ALLOWED_APPS.includes(event.appName.toLowerCase())) {
            return;
        }

        this.events.push(event);
    }

    /**
     * Finalizes the session and constructs the private witness for the ZK circuit.
     */
    public finalizeSession(sessionId: string): FocusWitness {
        if (!this.sessionStartTime) throw new Error('No active session to finalize');

        const endTime = Date.now();
        this.logEvent({ timestamp: endTime, type: 'focus_end', appName: 'system' });

        const durationMin = Math.floor((endTime - this.sessionStartTime) / 60000);
        const bitmap = this.generateFocusBitmap(durationMin);
        const totalActiveSeconds = this.calculateActiveSeconds();
        const cadenceHash = this.hashInputCadence();

        return {
            sessionId,
            startTime: this.sessionStartTime,
            endTime,
            totalActiveSeconds,
            inputCadenceHash: cadenceHash,
            appFocusBitmap: bitmap
        };
    }

    /**
     * Constructs the public inputs required for the smart contract or verifier.
     */
    public getPublicInputs(witness: FocusWitness, merkleRoot: string): PublicInputs {
        const durationMin = Math.floor((witness.endTime - witness.startTime) / 60000);
        return {
            sessionId: witness.sessionId,
            durationMinutes: durationMin,
            focusThresholdPercentage: 85, // Require 85% focus
            merkleRoot
        };
    }

    /**
     * Generates a bitmap where each bit represents 1 minute of verified focus.
     */
    private generateFocusBitmap(durationMin: number): Uint8Array {
        const byteLength = Math.ceil(durationMin / 8);
        const bitmap = new Uint8Array(byteLength);

        // Group events into 1-minute buckets
        const buckets = new Array(durationMin).fill(false);

        for (let i = 0; i < this.events.length - 1; i++) {
            const current = this.events[i];
            const next = this.events[i + 1];

            if (current.type === 'focus_start' || current.type === 'input_keystroke' || current.type === 'input_mouse') {
                const startMin = Math.floor((current.timestamp - this.sessionStartTime!) / 60000);
                const endMin = Math.min(Math.floor((next.timestamp - this.sessionStartTime!) / 60000), durationMin - 1);

                for (let m = startMin; m <= endMin; m++) {
                    if (m >= 0 && m < durationMin) {
                        buckets[m] = true;
                    }
                }
            }
        }

        // Pack booleans into Uint8Array bits
        for (let i = 0; i < durationMin; i++) {
            if (buckets[i]) {
                const byteIndex = Math.floor(i / 8);
                const bitIndex = i % 8;
                bitmap[byteIndex] |= (1 << bitIndex);
            }
        }

        return bitmap;
    }

    private calculateActiveSeconds(): number {
        let activeMs = 0;
        let lastActiveTimestamp = this.sessionStartTime!;

        for (const event of this.events) {
            if (event.type === 'input_keystroke' || event.type === 'input_mouse') {
                const delta = event.timestamp - lastActiveTimestamp;
                if (delta < 30000) { // Consider active if input within 30s
                    activeMs += delta;
                }
                lastActiveTimestamp = event.timestamp;
            }
        }

        return Math.floor(activeMs / 1000);
    }

    private hashInputCadence(): string {
        const inputEvents = this.events.filter(e => e.type.startsWith('input'));
        if (inputEvents.length < 10) return '0x00000000'; // Insufficient human proof

        const intervals: number[] = [];
        for (let i = 1; i < Math.min(inputEvents.length, 100); i++) {
            intervals.push(inputEvents[i].timestamp - inputEvents[i - 1].timestamp);
        }

        const intervalString = intervals.join(',');
        return this.fnv1aHash(intervalString);
    }

    private fnv1aHash(str: string): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return '0x' + (hash >>> 0).toString(16).padStart(8, '0');
    }

    private generateSessionId(): string {
        return 'sess_' + Math.random().toString(36).substring(2, 15);
    }
}
