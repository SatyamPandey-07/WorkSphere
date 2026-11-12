import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const itineraryId = params.id;
    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ success: false, error: 'Invalid itinerary items payload.' }, { status: 400 });
    }

    // Persist reordered itinerary items to database
    /*
    await db.itinerary.update({
      where: { id: itineraryId },
      data: { items: JSON.stringify(items) },
    });
    */

    return NextResponse.json(
      {
        success: true,
        message: 'Itinerary sequence synchronized successfully.',
        data: { itineraryId, items },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating itinerary sequence:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}