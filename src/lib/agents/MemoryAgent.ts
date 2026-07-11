import { prisma } from '@/lib/prisma';
import { Groq } from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'dummy-key-for-build',
});

export async function extractAndStoreMemories(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.messages.length === 0) {
    return { status: 'no_messages' };
  }

  const transcript = conversation.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  const extractionPrompt = `
You are an AI Memory Extraction Agent. Analyze the following conversation transcript between a user and an assistant.
Identify if the user explicitly stated any long-term preferences, requirements, or constraints that should be remembered for future interactions.
Examples of long-term preferences: "I need fast wifi", "I prefer quiet places", "I always want standing desks", "I am a vegetarian", "I hate noisy cafes".
Do NOT include temporary constraints for the current session (like "find me a place for tomorrow", "I'm in Brooklyn right now").

If you find long-term preferences, output them as a list of distinct, concise, first-person statements (one per line). For example:
I need fast wifi.
I prefer quiet places.

If there are no new long-term preferences, exactly output: NO_PREFERENCES

Transcript:
${transcript}
`;

  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: extractionPrompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
  });

  const responseText = completion.choices[0]?.message?.content?.trim() || '';

  if (responseText === 'NO_PREFERENCES' || responseText === '') {
    return { status: 'no_preferences' };
  }

  const preferences = responseText.split('\n').filter((p) => p.trim().length > 0 && p.trim() !== 'NO_PREFERENCES');

  const storedMemories = [];

  for (const pref of preferences) {
    const prefClean = pref.replace(/^[-*•\d.]\s*/, '').trim();
    
    // Generate embedding using Cohere
    const embedRes = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: [prefClean],
        model: 'embed-english-v3.0',
        input_type: 'search_document',
      }),
    });
    
    if (!embedRes.ok) {
      throw new Error(`Cohere API error: ${embedRes.statusText}`);
    }
    
    const embedData = await embedRes.json();
    const embedding = embedData.embeddings[0];
    const embeddingString = `[${embedding.join(',')}]`;
    
    // Store in Postgres using Prisma executeRaw
    await prisma.$executeRawUnsafe(`
      INSERT INTO "UserMemory" ("id", "userId", "content", "embedding", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        $1,
        $2,
        $3::vector,
        NOW()
      )
    `, conversation.userId, prefClean, embeddingString);
    
    storedMemories.push(prefClean);
  }

  return { status: 'extracted', count: storedMemories.length, memories: storedMemories };
}

/**
 * Consolidate user stated memories, favorites, and recent reviews/ratings
 * into a single unified profile summary and write it to User.preferencesSummary.
 */
export async function updateUserPreferencesSummary(userId: string): Promise<string | null> {
  try {
    // 1. Fetch user memories
    const memories = await prisma.userMemory.findMany({
      where: { userId },
      select: { content: true },
      orderBy: { createdAt: 'desc' },
      take: 15
    });

    // 2. Fetch favorites
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: { venue: true },
      take: 10
    });

    // 3. Fetch ratings
    const ratings = await prisma.venueRating.findMany({
      where: { userId },
      include: { venue: true },
      take: 10
    });

    if (memories.length === 0 && favorites.length === 0 && ratings.length === 0) {
      return null;
    }

    const memoryText = memories.map(m => m.content).join(", ");
    const favoritesText = favorites.map(f => `${f.venue.name} (${f.venue.category})`).join(", ");
    const ratingsText = ratings.map(r => {
      return `${r.venue.name}: rated WiFi ${r.wifiQuality}/5, Noise: ${r.noiseLevel}, Outlets: ${r.hasOutlets ? 'yes' : 'no'}`;
    }).join("\n");

    const summaryPrompt = `
You are a User Profile Analyst. Summarize the user's workspace preferences into a single, concise natural language sentence (under 50 words) from the first-person perspective (e.g., "I prefer quiet libraries and cafes with standing desks and fast WiFi for focus work, and I dislike noisy spaces.").

Inputs:
- User-stated memories/preferences: ${memoryText || "None"}
- Favorite venues: ${favoritesText || "None"}
- Recent ratings:
${ratingsText || "None"}

Provide ONLY the summary sentence. Do not add intro or outro text.
Summary:`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: summaryPrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || "";

    if (summary) {
      await prisma.user.update({
        where: { id: userId },
        data: { preferencesSummary: summary }
      });
      return summary;
    }
  } catch (error) {
    console.error("Error updating user preferences summary:", error);
  }
  return null;
}
