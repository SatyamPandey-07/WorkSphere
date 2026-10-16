import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { TimezoneOverlapMatrix } from '@/core/scheduling/TimezoneOverlapMatrix';
import { MeetingOptimizer } from '@/core/ai/MeetingOptimizer';

const bookingRequestSchema = z.object({
    venueId: z.string().uuid(),
    teamId: z.string().uuid(),
    meetingContext: z.object({
        title: z.string(),
        participants: z.array(z.string()),
        durationMinutes: z.number().int().min(15).max(240),
        urgency: z.enum(['low', 'medium', 'high', 'critical']),
        preferredTimeOfDay: z.enum(['morning', 'afternoon', 'evening']),
    }),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const matrix = new TimezoneOverlapMatrix();
const optimizer = new MeetingOptimizer(process.env.GROQ_API_KEY || '');

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validation = bookingRequestSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
        }

        const { venueId, teamId, meetingContext, targetDate } = validation.data;
        const date = new Date(targetDate);

        const teamMembers = await fetchTeamMembers(teamId);
        matrix.clearMembers();
        teamMembers.forEach(m => matrix.addMember(m));

        const overlaps = matrix.calculateOverlaps(date);
        const availablePods = await fetchAvailablePods(venueId, date);

        if (availablePods.length === 0) {
            return NextResponse.json({ error: 'No acoustic pods available' }, { status: 404 });
        }

        const optimizedSlots = await optimizer.optimizeMeeting(meetingContext, overlaps);

        if (optimizedSlots.length === 0) {
            return NextResponse.json({ error: 'No suitable meeting slots found' }, { status: 404 });
        }

        const bestSlot = optimizedSlots[0];
        const podToBook = availablePods[0];

        const bookingResult = await executePodBooking(venueId, podToBook.id, bestSlot.startUTC, bestSlot.endUTC, teamId);

        return NextResponse.json({
            success: true,
            bookingId: bookingResult.id,
            podId: podToBook.id,
            startTime: bestSlot.startUTC,
            endTime: bestSlot.endUTC,
            reasoning: bestSlot.reasoning,
        }, { status: 201 });

    } catch (error) {
        console.error('Pod scheduling API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

async function fetchTeamMembers(teamId: string): Promise<any[]> {
    return [];
}

async function fetchAvailablePods(venueId: string, date: Date): Promise<any[]> {
    return [{ id: 'pod-1', name: 'Focus Pod A' }];
}

async function executePodBooking(venueId: string, podId: string, start: number, end: number, teamId: string): Promise<{ id: string }> {
    return { id: crypto.randomUUID() };
}
