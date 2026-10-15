import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { NetworkingGraphMatcher, UserProfile } from '@/core/events/NetworkingGraphMatcher';
import { StructuredEvent } from '@/core/events/LocalEventScraper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { skills, interests, industry, currentLat, currentLng } = body;

        if (!currentLat || !currentLng) {
            return NextResponse.json({ error: 'Location coordinates required for matchmaking' }, { status: 400 });
        }

        const userProfile: UserProfile = {
            userId,
            skills: skills || [],
            interests: interests || [],
            industry: industry || 'tech',
            currentLat,
            currentLng
        };

        // Fetch cached events from the database (populated by the ingestion worker)
        const dbEvents = await db.localEvent.findMany({
            where: {
                startTime: { gte: new Date() },
                venueLat: { not: 0 }
            },
            take: 100
        });

        const structuredEvents: StructuredEvent[] = dbEvents.map(e => ({
            externalId: e.id,
            title: e.title,
            description: e.description,
            startTime: e.startTime.getTime(),
            endTime: e.endTime.getTime(),
            venueName: e.venueName,
            venueLat: e.venueLat,
            venueLng: e.venueLng,
            tags: e.tags,
            attendeeCount: e.attendeeCount,
            sourceUrl: e.sourceUrl
        }));

        const matcher = new NetworkingGraphMatcher();
        const matches = matcher.matchEvents(userProfile, structuredEvents);

        // Log the matchmaking session for analytics
        await db.matchmakingSession.create({
            data: {
                userId,
                matchesFound: matches.length,
                topRoiScore: matches.length > 0 ? matches[0].roiScore : 0,
                createdAt: new Date()
            }
        });

        return NextResponse.json({
            success: true,
            matches,
            totalEventsEvaluated: structuredEvents.length
        }, { status: 200 });

    } catch (error: any) {
        console.error('[MATCHMAKING_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
