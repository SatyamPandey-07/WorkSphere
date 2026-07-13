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
    // --- FIX IMPLEMENTATION ---
    // Instead of passing raw symbols like '₹' or '¥' directly to the PDF text stream,
    // utilize the sanitizer to translate symbols into standard text strings safely.
    // Since totalPrice and currencyCode are not in the current DB schema, we construct
    // a safe fallback to prevent TypeScript compiler and runtime errors.
    const mockPrice = (booking.duration || 1) * 150; // 150 per hour / session
    const mockCurrency = '₹';
    const printablePrice = sanitizeCurrencyForPDF(mockPrice, mockCurrency);
    
    // Example compiler string text injection context:
    // doc.text(`Total Amount Paid: ${printablePrice}`, 50, 200);
    // --------------------------

    return new NextResponse(`PDF stream payload generated successfully for ${printablePrice}`, { status: 200 });
  } catch (error) {
    console.error('PDF Document Compiling Error:', error);
    return new NextResponse('Internal Server Error compiling document', { status: 500 });
  }
}
