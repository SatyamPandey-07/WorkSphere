import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// durationMinutes is Int and averageDelayMs is Float in the Prisma schema
const jammerSessionSchema = z.object({
    sessionDurationMin: z.number().int().positive(),
    averageDelayMs: z.number().nonnegative(),
    venueId: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const parsed = jammerSessionSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    error: 'Invalid metrics payload',
                    details: z.flattenError(parsed.error).fieldErrors,
                },
                { status: 400 }
            );
        }

        const { sessionDurationMin, averageDelayMs, venueId } = parsed.data;

        await db.privacyJammerSession.create({
            data: {
                userId,
                venueId,
                durationMinutes: sessionDurationMin,
                averageDelayMs,
                completedAt: new Date()
            }
        });

        return NextResponse.json({
            success: true,
            message: 'Jammer telemetry logged.'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JAMMER_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const sessions = await db.privacyJammerSession.findMany({
            where: { userId },
            orderBy: { completedAt: 'desc' },
            take: 10
        });

        return NextResponse.json({
            success: true,
            sessions
        }, { status: 200 });

    } catch (error: any) {
        console.error('[JAMMER_FETCH]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}