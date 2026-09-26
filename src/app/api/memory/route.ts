import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';

export async function GET(_request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const memories = await prisma.userMemory.findMany({
      where: { userId },
      select: {
        id: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ memories });
  } catch (error: any) {
    console.error('Error fetching memories:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const clearAll = searchParams.get('clearAll');

    if (clearAll === 'true') {
      await prisma.userMemory.deleteMany({
        where: { userId },
      });
      return NextResponse.json({ success: true, message: 'All memories cleared' });
    }

    if (!id) {
      return NextResponse.json({ error: 'Memory ID is required' }, { status: 400 });
    }

    await prisma.userMemory.delete({
      where: { id, userId },
    });

    return NextResponse.json({ success: true, message: 'Memory deleted' });
  } catch (error: any) {
    console.error('Error deleting memory:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { content, embedding } = body;

    if (!content || !Array.isArray(embedding)) {
      return NextResponse.json({ error: 'Missing content or invalid embedding format' }, { status: 400 });
    }

    // Use raw SQL to insert the embedding as a pgvector vector type
    await prisma.$executeRaw`
      INSERT INTO "UserMemory" ("id", "userId", "content", "embedding", "createdAt")
      VALUES (
        gen_random_uuid(), 
        ${userId}, 
        ${content}, 
        ${embedding}::vector, 
        NOW()
      )
    `;

    return NextResponse.json({ success: true, message: 'Memory saved successfully' });
  } catch (error) {
    console.error('Error saving memory:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
