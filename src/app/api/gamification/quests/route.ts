/**
 * route.ts
 * API endpoint that serves the active quest list and tracks user progress.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { QuestEngine } from '@/core/gamification/QuestEngine';

// In-memory engine for scaffold (use DB in production)
const questEngine = new QuestEngine();

export async function GET(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const activeQuests = questEngine.getActiveQuests();
        const progress = questEngine.getUserProgress();

        return NextResponse.json({
            success: true,
            quests: activeQuests,
            progress
        }, { status: 200 });

    } catch (error) {
        console.error('Quests API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { questId, increment } = body;

        if (!questId) {
            return NextResponse.json({ error: 'Missing questId' }, { status: 400 });
        }

        const progress = questEngine.recordTelemetry(userId, questId, increment || 1);

        return NextResponse.json({
            success: true,
            progress
        }, { status: 200 });

    } catch (error) {
        console.error('Quest progress API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
