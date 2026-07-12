import { NextRequest, NextResponse } from 'next/server';
import { EventBus } from '@/lib/events/bus';

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    await EventBus.emit({
      type: 'DOCUMENT_SIGNED',
      userId: userId,
      data: {
        documentId: 'doc_123',
        signedAt: new Date().toISOString()
      }
    });

    return NextResponse.json({ success: true, message: 'Event emitted to queue' });
  } catch {
    return NextResponse.json({ error: 'Failed to emit event' }, { status: 500 });
  }
}
