import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const correctionSchema = z.object({
    venueId: z.string().uuid(),
    menuItem: z.string().min(1).max(255),
    originalText: z.string(),
    correctedText: z.string(),
    userId: z.string().uuid(),
    timestamp: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = correctionSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Invalid payload', details: validation.error.flatten() },
                { status: 400 }
            );
        }

        const { venueId, menuItem, originalText, correctedText, userId, timestamp } = validation.data;

        const isSpam = await checkForSpam(userId, timestamp);
        if (isSpam) {
            return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }

        const dbResult = await saveMenuCorrection({
            venueId,
            menuItem,
            originalText,
            correctedText,
            userId,
            timestamp,
        });

        if (!dbResult.success) {
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        await updateGlobalIngredientDatabase(correctedText);

        return NextResponse.json({
            success: true,
            message: 'Correction logged and global database queued for update',
            correctionId: dbResult.id
        }, { status: 201 });

    } catch (error) {
        console.error('Menu correction API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

async function checkForSpam(userId: string, timestamp: number): Promise<boolean> {
    const oneMinuteAgo = timestamp - 60000;
    const recentSubmissions = await getRecentSubmissions(userId, oneMinuteAgo);
    return recentSubmissions > 5;
}

async function getRecentSubmissions(userId: string, since: number): Promise<number> {
    return Math.floor(Math.random() * 3);
}

async function saveMenuCorrection(data: any): Promise<{ success: boolean; id?: string }> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true, id: crypto.randomUUID() };
}

async function updateGlobalIngredientDatabase(text: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const corrections = await fetchVenueCorrections(venueId);
    return NextResponse.json({ corrections }, { status: 200 });
}

async function fetchVenueCorrections(venueId: string): Promise<any[]> {
    return [];
}
