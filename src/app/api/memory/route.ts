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

    const result = await prisma.userMemory.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

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

    // The embedding column is vector(1024): reject shapes the database
    // could never store before any SQL runs.
    const EMBEDDING_DIMENSIONS = 1024;
    const MAX_CONTENT_LENGTH = 20000;

    if (typeof content !== "string" || content.length === 0) {
      return NextResponse.json({ error: "Memory content is required" }, { status: 400 });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: "Memory content exceeds maximum length" }, { status: 400 });
    }

    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      return NextResponse.json({ error: "Embedding must be an array of 1024 finite numbers" }, { status: 400 });
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
