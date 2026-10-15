import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { sessionDurationMin, averageStrainScore, peakStrainJoint } = body;

    if (!sessionDurationMin || averageStrainScore === undefined) {
      return NextResponse.json({ error: 'Missing session metrics' }, { status: 400 });
    }

    await db.ergonomicSession.create({
      data: {
        userId,
        durationMinutes: sessionDurationMin,
        averageStrainScore,
        peakStrainJoint: peakStrainJoint || 'unknown',
        completedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Ergonomic session logged successfully.'
    }, { status: 200 });

  } catch (error: any) {
    console.error('[ERGONOMICS_API]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await db.ergonomicSession.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      take: 30
    });

    const averageStrain = sessions.length > 0 
      ? sessions.reduce((acc, s) => acc + s.averageStrainScore, 0) / sessions.length 
      : 0;

    return NextResponse.json({
      success: true,
      sessions,
      monthlyAverageStrain: averageStrain
    }, { status: 200 });

  } catch (error: any) {
    console.error('[ERGONOMICS_FETCH]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
