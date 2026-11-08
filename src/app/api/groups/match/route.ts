import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, location } = body;

        // Mocked trigger for the background worker
        console.log(`[API] Triggering matchmaking batch job for location: ${location}`);

        return NextResponse.json({
            success: true,
            message: 'Matchmaking job queued.',
            jobId: `job_${Date.now()}`
        }, { status: 202 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
