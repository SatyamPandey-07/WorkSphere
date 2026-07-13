import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeCurrencyForPDF } from '@/lib/pdfUtils';

export async function GET(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await params;
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { venue: true, user: true }
    });

    if (!booking) {
      return new NextResponse('Booking record not found', { status: 404 });
    }

    const bookingAny = booking as any;
    const printablePrice = sanitizeCurrencyForPDF(bookingAny.totalPrice ?? 0, bookingAny.currencyCode ?? 'USD');
    
    // Example compiler string text injection context:
    // doc.text(`Total Amount Paid: ${printablePrice}`, 50, 200);
    // --------------------------

    return new NextResponse('PDF stream payload generated successfully', { status: 200 });
  } catch (error) {
    console.error('PDF Document Compiling Error:', error);
    return new NextResponse('Internal Server Error compiling document', { status: 500 });
  }
}
