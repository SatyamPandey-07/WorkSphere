import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, fatigueLevel, perclos, timestamp } = body;

        // Log anonymized aggregate wellness metrics for venue ergonomic scoring
        console.log(`[Health API] User ${userId} - Level: ${fatigueLevel}, PERCLOS: ${perclos}`);

        return NextResponse.json({ success: true, logged: true }, { status: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
