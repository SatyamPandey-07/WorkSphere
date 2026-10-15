/**
 * match/route.ts
 * API endpoint that indexes user skill embeddings and returns optimal local barter matches.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface SkillProfile {
    userId: string;
    skillsOffered: string[];
    skillsRequested: string[];
    locationId: string;
    availability: string[]; // ISO date strings
}

export interface MatchResult {
    userId: string;
    matchScore: number;
    offeredSkill: string;
    requestedSkill: string;
}

// Mock database of user profiles
const mockProfiles: SkillProfile[] = [
    {
        userId: 'user-1',
        skillsOffered: ['React', 'TypeScript', 'Next.js'],
        skillsRequested: ['UI/UX Design', 'Figma'],
        locationId: 'venue-a',
        availability: ['2026-10-15T09:00:00Z'],
    },
    {
        userId: 'user-2',
        skillsOffered: ['UI/UX Design', 'Figma', 'User Research'],
        skillsRequested: ['React', 'Frontend Development'],
        locationId: 'venue-a',
        availability: ['2026-10-15T10:00:00Z'],
    },
    {
        userId: 'user-3',
        skillsOffered: ['Python', 'Data Science'],
        skillsRequested: ['Marketing'],
        locationId: 'venue-b',
        availability: ['2026-10-16T14:00:00Z'],
    },
];

function calculateMatchScore(profileA: SkillProfile, profileB: SkillProfile): MatchResult | null {
    // Check if A offers what B wants AND B offers what A wants
    const aOffersB = profileA.skillsOffered.filter(s => profileB.skillsRequested.includes(s));
    const bOffersA = profileB.skillsOffered.filter(s => profileA.skillsRequested.includes(s));

    if (aOffersB.length > 0 && bOffersA.length > 0) {
        // Simple scoring: number of matching skills
        const score = (aOffersB.length + bOffersA.length) / 2;

        return {
            userId: profileB.userId,
            matchScore: score,
            offeredSkill: bOffersA[0], // What B offers A
            requestedSkill: aOffersB[0], // What A offers B
        };
    }

    return null;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, locationId } = body;

        if (!userId) {
            return NextResponse.json(
                { error: 'userId is required' },
                { status: 400 }
            );
        }

        const userProfile = mockProfiles.find(p => p.userId === userId);
        if (!userProfile) {
            return NextResponse.json(
                { error: 'User profile not found' },
                { status: 404 }
            );
        }

        // Filter by location if provided
        const candidates = mockProfiles.filter(
            p => p.userId !== userId && (!locationId || p.locationId === locationId)
        );

        const matches: MatchResult[] = [];
        for (const candidate of candidates) {
            const match = calculateMatchScore(userProfile, candidate);
            if (match) {
                matches.push(match);
            }
        }

        // Sort by score descending
        matches.sort((a, b) => b.matchScore - a.matchScore);

        return NextResponse.json({
            success: true,
            data: matches.slice(0, 10), // Top 10 matches
        });
    } catch (error: any) {
        console.error('[Match API] Error finding matches:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}