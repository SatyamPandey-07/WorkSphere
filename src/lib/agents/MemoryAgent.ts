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
