/**
 * POST /api/sessions/deepwork
 * Syncs calendar events, triggers the AI scheduler, and provisions new Deep Work sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { DeepWorkScheduler } from '@/core/ai/DeepWorkScheduler';
import { ContextSwitchingGuard } from '@/core/ai/ContextSwitchingGuard';
import { SessionStatus, ContextRules, DeepWorkSession } from '@/types/deepwork';

// Mocked dependencies
const mockCalendarEvents = [
    { id: 'evt-1', title: 'Standup', start: Date.now() + 3600000, end: Date.now() + 3600000 + 1800000, isRecurring: true },
    { id: 'evt-2', title: 'Design Review', start: Date.now() + 7200000, end: Date.now() + 7200000 + 3600000, isRecurring: false }
];

const mockTasks = [
    { id: 'task-1', title: 'Refactor Auth Module', estimatedMinutes: 90, cognitiveLoad: 'HIGH' as const },
    { id: 'task-2', title: 'Write Unit Tests', estimatedMinutes: 45, cognitiveLoad: 'MEDIUM' as const }
];

const scheduler = new DeepWorkScheduler(process.env.GROQ_API_KEY || 'mock-key');
const guard = new ContextSwitchingGuard();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, action, sessionId } = body;

        if (!userId) {
            return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
        }

        if (action === 'GENERATE_SCHEDULE') {
            const recommendations = await scheduler.generateSchedule(
                mockCalendarEvents,
                mockTasks,
                { start: 9, end: 17 }
            );
            return NextResponse.json({ success: true, recommendations }, { status: 200 });
        }

        if (action === 'START_SESSION') {
            const { startTime, endTime, rules } = body;

            const newSession: DeepWorkSession = {
                sessionId: `sess_${Date.now()}`,
                userId,
                status: SessionStatus.ACTIVE,
                startTime,
                endTime,
                targetTasks: mockTasks,
                rules: rules || {
                    blockSocialNotifications: true,
                    hideCommunityChat: true,
                    enforceFullscreen: false,
                    allowMusic: true,
                    strictMode: true
                },
                extensionsGranted: 0
            };

            guard.startSession(newSession);

            return NextResponse.json({
                success: true,
                session: newSession,
                enforcedUI: guard.getEnforcedUIState(userId)
            }, { status: 201 });
        }

        if (action === 'END_SESSION' && sessionId) {
            guard.endSession(sessionId);
            return NextResponse.json({ success: true, message: 'Session terminated.' }, { status: 200 });
        }

        return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });

    } catch (error: any) {
        console.error('[API] Deep Work session error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    return NextResponse.json({
        enforcedUI: guard.getEnforcedUIState(userId),
        timestamp: Date.now()
    });
}