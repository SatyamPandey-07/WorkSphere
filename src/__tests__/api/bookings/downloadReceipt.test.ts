import { NextRequest } from 'next/server';
import { GET } from '@/app/api/bookings/[id]/download/route';
import { sanitizeForWinAnsi } from '@/lib/pdf/unicodeTextHelper';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        booking: {
            findUnique: jest.fn(),
        },
    },
}));

const mockedFindUnique = prisma.booking.findUnique as jest.Mock;

describe('GET /api/bookings/[id]/download (Unicode PDF Receipt Fix)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('sanitizes Devanagari, accented European, currency, and emoji strings for WinAnsi encoding', () => {
        expect(sanitizeForWinAnsi('Café München — पुणे (₹450) 🚀')).toBe(
            'Café München - Pune (INR 450)'
        );
    });

    test('generates HTTP 200 PDF receipt without WinAnsi encoding errors for non-Latin venue and guest names', async () => {
        mockedFindUnique.mockResolvedValueOnce({
            id: 'clx_unicode_9912',
            confirmationCode: 'WS-PUNE-2026',
            status: 'CONFIRMED',
            startTime: new Date('2026-11-21T09:00:00.000Z'),
            endTime: new Date('2026-11-21T13:00:00.000Z'),
            totalAmount: 450,
            currency: '₹',
            venue: {
                name: 'Café München & पुणे Co-Work Hub',
                address: 'बावधन, पुणे, Maharashtra 411021',
            },
            user: {
                name: 'आदित्य महाजन (Aditya Mahajan)',
                email: 'aditya@worksphere.app',
            },
        });

        const req = new NextRequest(
            'http://localhost:3000/api/bookings/clx_unicode_9912/download'
        );
        const res = await GET(req, {
            params: Promise.resolve({ id: 'clx_unicode_9912' }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
        expect(res.headers.get('Content-Disposition')).toContain(
            'worksphere-receipt-WS-PUNE-2026.pdf'
        );

        const arrayBuffer = await res.arrayBuffer();
        const header = new TextDecoder().decode(arrayBuffer.slice(0, 8));
        expect(header).toContain('%PDF-');
    });
});