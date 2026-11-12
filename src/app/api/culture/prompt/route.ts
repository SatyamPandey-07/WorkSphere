import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { EtiquetteGraph } from '@/core/culture/EtiquetteGraph';
import { CulturalPrompter } from '@/core/ai/CulturalPrompter';

const promptRequestSchema = z.object({
    userOriginCountry: z.string().length(2),
    currentCountry: z.string().length(2),
    venueType: z.enum(['cafe', 'coworking', 'library', 'restaurant']),
    userLanguage: z.string().default('en'),
});

const frictionLogSchema = z.object({
    userId: z.string().uuid(),
    countryCode: z.string().length(2),
    venueType: z.string(),
    category: z.string(),
    timestamp: z.number().int().positive(),
});

const graph = new EtiquetteGraph();
const prompter = new CulturalPrompter(process.env.GROQ_API_KEY || '');

export async function POST(req: NextRequest) {
    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    try {
        if (path === 'generate') {
            return await handleGenerate(req);
        } else if (path === 'log-friction') {
            return await handleFrictionLog(req);
        }

        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } catch (error: any) {
        console.error('Culture prompt API error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

async function handleGenerate(req: NextRequest) {
    const body = await req.json();
    const validation = promptRequestSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    const { userOriginCountry, currentCountry, venueType, userLanguage } = validation.data;
    const norms = graph.getNorms(currentCountry, venueType);

    const reminders = await prompter.generateReminders({
        userOriginCountry,
        currentCountry,
        venueType,
        applicableNorms: norms,
        userLanguage,
    });

    return NextResponse.json({ reminders }, { status: 200 });
}

async function handleFrictionLog(req: NextRequest) {
    const body = await req.json();
    const validation = frictionLogSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid payload', details: validation.error.flatten() }, { status: 400 });
    }

    // Log anonymized friction points for community improvement
    await saveFrictionPoint(validation.data);

    return NextResponse.json({ success: true }, { status: 201 });
}

async function saveFrictionPoint(data: any): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
}
