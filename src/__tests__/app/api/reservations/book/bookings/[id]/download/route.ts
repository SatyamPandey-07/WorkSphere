import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { resolveReceiptFonts } from '@/lib/pdf/unicodeTextHelper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function computeReceiptHmacSignature(payload: string): Promise<string> {
    const secret =
        process.env.RECEIPT_HMAC_SECRET ??
        process.env.CLERK_SECRET_KEY ??
        'worksphere-dev-receipt-secret';

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;
        const bookingId = id?.trim();

        if (!bookingId) {
            return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 });
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                venue: true,
                user: true,
            },
        });

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }

        const pdfDoc = await PDFDocument.create();
        const fonts = await resolveReceiptFonts(pdfDoc);
        const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait

        const drawSafe = (
            rawText: string,
            opts: {
                x: number;
                y: number;
                size: number;
                bold?: boolean;
                color?: ReturnType<typeof rgb>;
            }
        ) => {
            const safeText = fonts.encodeText(rawText);
            page.drawText(safeText, {
                x: opts.x,
                y: opts.y,
                size: opts.size,
                font: opts.bold ? fonts.bold : fonts.regular,
                color: opts.color ?? rgb(0.12, 0.14, 0.18),
            });
        };

        const confirmationCode =
            (booking as { confirmationCode?: string }).confirmationCode ??
            booking.id.slice(0, 10).toUpperCase();

        const venueName = booking.venue?.name ?? 'WorkSphere Partner Space';
        const venueAddress = booking.venue?.address ?? 'Address on file';
        const guestName =
            booking.user?.name ?? booking.user?.email ?? 'Verified Nomad Member';

        const startIso = new Date(booking.startTime).toISOString();
        const endIso = new Date(booking.endTime).toISOString();
        const amountDisplay =
            typeof (booking as { totalAmount?: number }).totalAmount === 'number'
                ? `${(booking as { currency?: string }).currency ?? 'INR'} ${(
                    booking as { totalAmount: number }
                ).totalAmount.toFixed(2)}`
                : 'Confirmed Pass';

        const signature = await computeReceiptHmacSignature(
            `${booking.id}|${confirmationCode}|${startIso}|${endIso}`
        );

        // Header banner
        page.drawRectangle({
            x: 40,
            y: 745,
            width: 515,
            height: 60,
            color: rgb(0.08, 0.09, 0.13),
        });

        drawSafe('WORKSPHERE NEURAL LEDGER', {
            x: 56,
            y: 780,
            size: 16,
            bold: true,
            color: rgb(1, 1, 1),
        });
        drawSafe('Official Workspace Reservation Receipt', {
            x: 56,
            y: 760,
            size: 10,
            color: rgb(0.75, 0.78, 0.85),
        });

        // Receipt Metadata Rows
        let y = 705;
        const rows: Array<[string, string]> = [
            ['Confirmation Code:', confirmationCode],
            ['Booking ID:', booking.id],
            ['Status:', String(booking.status ?? 'CONFIRMED')],
            ['Reserved For:', guestName],
            ['Workspace Venue:', venueName],
            ['Venue Address:', venueAddress],
            ['Check-In (UTC):', startIso],
            ['Check-Out (UTC):', endIso],
            ['Total Paid:', amountDisplay],
        ];

        for (const [label, value] of rows) {
            drawSafe(label, { x: 48, y, size: 11, bold: true, color: rgb(0.32, 0.35, 0.42) });
            drawSafe(value, { x: 185, y, size: 11, bold: false, color: rgb(0.1, 0.11, 0.14) });
            y -= 28;
        }

        // Cryptographic Verification Footer
        page.drawLine({
            start: { x: 48, y: y - 10 },
            end: { x: 547, y: y - 10 },
            thickness: 1,
            color: rgb(0.85, 0.87, 0.9),
        });

        drawSafe('HMAC-SHA256 Verification Digest:', {
            x: 48,
            y: y - 34,
            size: 9,
            bold: true,
            color: rgb(0.35, 0.38, 0.45),
        });
        drawSafe(signature, {
            x: 48,
            y: y - 50,
            size: 8,
            color: rgb(0.45, 0.48, 0.55),
        });

        const pdfBytes = await pdfDoc.save();
        const safeFilename = `worksphere-receipt-${confirmationCode.replace(/[^a-zA-Z0-9-_]/g, '')}.pdf`;

        return new NextResponse(Buffer.from(pdfBytes), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${safeFilename}"`,
                'Cache-Control': 'no-store, max-age=0',
            },
        });
    } catch (error: unknown) {
        console.error('[BookingReceiptDownload] Failed to generate PDF receipt:', error);
        return NextResponse.json(
            { error: 'Failed to generate booking receipt PDF' },
            { status: 500 }
        );
    }
}