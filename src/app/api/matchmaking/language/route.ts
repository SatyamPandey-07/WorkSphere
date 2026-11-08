import { NextRequest, NextResponse } from 'next/server';
import { LanguageExchangeGraph, UserLanguageProfile } from '@/core/matchmaking/LanguageExchangeGraph';
import { IcebreakerGenerator } from '@/core/ai/IcebreakerGenerator';

// In-memory graph for demonstration. In production, use Redis or a persistent store.
const exchangeGraph = new LanguageExchangeGraph();
const icebreakerGen = new IcebreakerGenerator(process.env.GROQ_API_KEY || 'mock_key');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, profile, bleZoneHash } = body;

    if (action === 'PING') {
      if (!profile || !bleZoneHash) {
        return NextResponse.json({ error: 'Missing profile or BLE zone hash' }, { status: 400 });
      }

      const userProfile: UserLanguageProfile = {
        ...profile,
        locationHash: bleZoneHash,
        lastActive: Date.now()
      };

      exchangeGraph.addUser(userProfile);
      const match = exchangeGraph.findBestMatch(userProfile.userId);

      if (match) {
        const userA = exchangeGraph.getProfile(match.userA);
        const userB = exchangeGraph.getProfile(match.userB);

        if (userA && userB) {
          const icebreaker = await icebreakerGen.generate({
            userAName: userA.userId, // In real app, fetch actual name
            userBName: userB.userId,
            userAProfession: 'Software Engineer', // Mocked
            userBProfession: 'Designer', // Mocked
            edge: match,
            venueContext: 'Local Cafe'
          });

          return NextResponse.json({
            matched: true,
            match,
            icebreaker,
            roomId: `lang-exchange-${match.userA}-${match.userB}`
          });
        }
      }

      return NextResponse.json({ matched: false });
    }

    if (action === 'LEAVE') {
      if (!profile?.userId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
      }
      exchangeGraph.removeUser(profile.userId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Language Matchmaking API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
