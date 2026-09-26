import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { randomBytes } from 'crypto';

function generateConfirmationId() {
  return `WS-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bookings = await prisma.booking.findMany({
      where: { userId: user.id },
      include: { venue: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: bookings });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    // Use Clerk to get the user ID and primary email address required by the schema
    if (!user || !user.primaryEmailAddress) {
      return NextResponse.json({ error: 'Unauthorized or missing email' }, { status: 401 });
    }

    const body = await request.json();
    const { venueId, date, time } = body;

    if (!venueId || !date || !time) {
      return NextResponse.json({ error: 'Missing required booking fields' }, { status: 400 });
    }

    const newBooking = await prisma.booking.create({
      data: {
        userId: user.id,
        venueId,
        date,
        time,
        customerEmail: user.primaryEmailAddress.emailAddress,
        status: 'CONFIRMED',
        confirmationId: generateConfirmationId(),
      },
      include: { venue: true },
    });

    return NextResponse.json({ success: true, data: newBooking });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create reservation' }, { status: 500 });
  }
}
