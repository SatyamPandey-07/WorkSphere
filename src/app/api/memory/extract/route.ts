import { NextRequest, NextResponse } from 'next/server';
import { extractAndStoreMemories } from '@/lib/agents/MemoryAgent';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { conversationId } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID is required' }, { status: 400 });
    }

    // Process memory extraction
    const result = await extractAndStoreMemories(conversationId);

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('Error extracting memory:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
