import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { sanitizeCurrencyForPDF } from '@/lib/pdfUtils';
// Assume your existing PDF constructor package (e.g., pdfkit) is imported here

export async function GET(request: Request, { params }: { params: { bookingId: string } }) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: params.bookingId },
      include: { venue: true, user: true }
    });

    if (!booking) {
      return new NextResponse('Booking record not found', { status: 404 });
    }

    // --- FIX IMPLEMENTATION ---
    // Instead of passing raw symbols like '₹' or '¥' directly to the PDF text stream,
    // utilize the sanitizer to translate symbols into standard text strings safely.
    const printablePrice = sanitizeCurrencyForPDF(booking.totalPrice, booking.currencyCode);
    
    // Example compiler string text injection context:
    // doc.text(`Total Amount Paid: ${printablePrice}`, 50, 200);
    // --------------------------

    return new NextResponse('PDF stream payload generated successfully', { status: 200 });
  } catch (error) {
    console.error('PDF Document Compiling Error:', error);
    return new NextResponse('Internal Server Error compiling document', { status: 500 });
  }
}
