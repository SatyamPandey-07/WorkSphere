import { NextRequest, NextResponse } from 'next/server';
import { BiometricPomodoroEngine, SessionPhase, IntervalConfig } from '@/core/productivity/BiometricPomodoroEngine';

// In-memory store for demonstration. In production, use Redis or DB.
const activeSessions = new Map<string, BiometricPomodoroEngine>();

const defaultConfig: IntervalConfig = {
    baseWorkDuration: 25 * 60 * 1000,
    baseShortBreak: 5 * 60 * 1000,
    baseLongBreak: 15 * 60 * 1000,
    sessionsUntilLongBreak: 4,
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, action, biometricData } = body;

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        let engine = activeSessions.get(userId);

        if (action === 'START') {
            engine = new BiometricPomodoroEngine(defaultConfig);
            activeSessions.set(userId, engine);
            const state = engine.startSession();
            return NextResponse.json({ success: true, state });
        }

        if (action === 'UPDATE' && biometricData) {
            if (!engine) {
                return NextResponse.json({ error: 'No active session found' }, { status: 404 });
            }
            const state = engine.updateBiometrics(biometricData);
            return NextResponse.json({ success: true, state });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Flow API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const engine = activeSessions.get(userId);
    if (!engine) {
        return NextResponse.json({ phase: SessionPhase.IDLE });
    }

    return NextResponse.json(engine.getState());
}
