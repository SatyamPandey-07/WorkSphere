import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { role, venueId } = body;

        if (!role || !venueId) {
            return NextResponse.json({ error: 'Missing role or venueId' }, { status: 400 });
        }

        const meshToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await db.meshSession.create({
            data: {
                userId,
                venueId,
                role,
                meshToken,
                expiresAt,
                contributionMb: 0
            }
        });

        return NextResponse.json({
            success: true,
            meshToken,
            partyKitRoom: `bandwidth-mesh-${venueId}`,
            expiresAt
        }, { status: 200 });

    } catch (error: any) {
        console.error('[MULTIPLEX_API]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const sessions = await db.meshSession.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        const totalContribution = sessions.reduce((acc, s) => acc + s.contributionMb, 0);

        return NextResponse.json({
            success: true,
            sessions,
            totalContributionMb: totalContribution
        }, { status: 200 });

    } catch (error: any) {
        console.error('[MULTIPLEX_FETCH]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
