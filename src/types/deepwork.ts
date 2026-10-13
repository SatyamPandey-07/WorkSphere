/**
 * Shared types for the Deep Work Session Scheduler and Context Guard
 */

export enum SessionStatus {
    SCHEDULED = 'SCHEDULED',
    ACTIVE = 'ACTIVE',
    PAUSED = 'PAUSED',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

export interface TaskComplexity {
    id: string;
    title: string;
    estimatedMinutes: number;
    cognitiveLoad: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface DeepWorkSession {
    sessionId: string;
    userId: string;
    status: SessionStatus;
    startTime: number;
    endTime: number;
    targetTasks: TaskComplexity[];
    rules: ContextRules;
    extensionsGranted: number;
}

export interface ContextRules {
    blockSocialNotifications: boolean;
    hideCommunityChat: boolean;
    enforceFullscreen: boolean;
    allowMusic: boolean;
    strictMode: boolean; // Prevents manual cancellation without penalty
}

export interface CalendarEvent {
    id: string;
    title: string;
    start: number;
    end: number;
    isRecurring: boolean;
}

export interface SchedulerRecommendation {
    proposedStart: number;
    proposedEnd: number;
    confidenceScore: number; // 0.0 to 1.0
    reasoning: string;
    tasksToInclude: string[]; // Task IDs
}
