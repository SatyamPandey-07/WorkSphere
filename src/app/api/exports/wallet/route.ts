/**
 * GET /api/exports/wallet
 * Serves the generated binary .pkpass files and itinerary PDFs to the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ItineraryPdfRenderer } from '@/core/pdf/ItineraryPdfRenderer';
import { PassGenerator } from '@/core/wallet/PassGenerator';

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const type = url.searchParams.get('type'); // 'pdf' or 'pkpass'
    const bookingId = url.searchParams.get('bookingId');

    if (!bookingId) {
        return NextResponse.json({ error: 'Booking ID required' }, { status: 400 });
    }

    // Mock data fetch
    const mockData = {
        userId: 'u-123',
        userName: 'Jane Doe',
        date: '2026-10-15',
        bookings: [
            {
                venueName: 'The Grid Coworking',
                deskId: 'A-42',
                startTime: '09:00',
                endTime: '17:00',
                qrCodeData: `WS-${bookingId}-A42`,
                address: '123 Innovation Dr, Tech City'
            }
        ]
    };

    if (type === 'pdf') {
        const renderer = new ItineraryPdfRenderer();
        const pdfBytes = await renderer.generate(mockData);

        return new NextResponse(pdfBytes, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="itinerary-${bookingId}.pdf"`
            }
        });
    }

    if (type === 'pkpass') {
        const generator = new PassGenerator('pass.com.worksphere.booking', 'ABCDE12345');
        const passData = {
            venueName: mockData.bookings[0].venueName,
            deskId: mockData.bookings[0].deskId,
            date: mockData.date,
            qrCodeData: mockData.bookings[0].qrCodeData,
            logoText: 'WorkSphere'
        };

        const mockAssets = {
            'icon.png': Buffer.from('mock-icon-data'),
            'logo.png': Buffer.from('mock-logo-data')
        };

        const pkPassBuffer = await generator.createPkPassArchive(passData, mockAssets);

        return new NextResponse(pkPassBuffer, {
            headers: {
                'Content-Type': 'application/vnd.apple.pkpass',
                'Content-Disposition': `attachment; filename="booking-${bookingId}.pkpass"`
            }
        });
    }

    return NextResponse.json({ error: 'Invalid export type' }, { status: 400 });
}
