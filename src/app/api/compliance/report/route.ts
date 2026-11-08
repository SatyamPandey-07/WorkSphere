/**
 * report/route.ts
 * API endpoint that generates and serves cryptographically signed PDF compliance reports for the user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface ReportRequest {
    userId: string;
    reportType: 'tax' | 'visa' | 'full';
    dateRange: { start: string; end: string };
}

export interface ReportMetadata {
    reportId: string;
    userId: string;
    generatedAt: number;
    type: string;
    signature: string;
    downloadUrl: string;
}

// Mock PDF generation and signing
async function generateSignedPdf(userId: string, type: string): Promise<{ url: string; signature: string }> {
    // In reality, this would use pdf-lib to construct a multi-page document
    // containing the user's travel history, day counts, and legal disclaimers.

    const mockPdfBuffer = Buffer.from(`%PDF-1.4\nMock PDF Content for ${userId} - ${type}\n%%EOF`);
    const reportId = randomUUID();

    // Mock cryptographic signature (e.g., using a private key to sign the PDF hash)
    const signature = `SIG-${reportId}-${Date.now()}`;

    // Mock uploading to S3/Cloudflare R2
    const downloadUrl = `/api/compliance/download/${reportId}`;

    return { url: downloadUrl, signature };
}

export async function POST(request: NextRequest) {
    try {
        const body: ReportRequest = await request.json();
        const { userId, reportType, dateRange } = body;

        if (!userId || !reportType || !dateRange) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Validate date range
        const start = new Date(dateRange.start);
        const end = new Date(dateRange.end);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
            return NextResponse.json(
                { error: 'Invalid date range' },
                { status: 400 }
            );
        }

        console.log(`[Report API] Generating ${reportType} report for ${userId} from ${dateRange.start} to ${dateRange.end}`);

        const { url, signature } = await generateSignedPdf(userId, reportType);

        const metadata: ReportMetadata = {
            reportId: randomUUID(),
            userId,
            generatedAt: Date.now(),
            type: reportType,
            signature,
            downloadUrl: url,
        };

        // In reality, save metadata to DB linked to the user

        return NextResponse.json({
            success: true,
            data: metadata,
        });
    } catch (error: any) {
        console.error('[Report API] Error generating report:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json(
            { error: 'userId is required' },
            { status: 400 }
        );
    }

    // Mock fetching past reports
    const pastReports: ReportMetadata[] = [
        {
            reportId: 'rep-123',
            userId,
            generatedAt: Date.now() - 86400000,
            type: 'full',
            signature: 'SIG-rep-123',
            downloadUrl: '/api/compliance/download/rep-123',
        },
    ];

    return NextResponse.json({
        success: true,
        data: pastReports,
    });
}
