import { NextRequest, NextResponse } from 'next/server';
import { ExpenseCategorizer, RawReceiptLine } from '@/core/finance/ExpenseCategorizer';

const categorizer = new ExpenseCategorizer(process.env.GROQ_API_KEY || 'mock_key');

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, lines } = body;

        if (action === 'CATEGORIZE') {
            if (!lines || !Array.isArray(lines)) {
                return NextResponse.json({ error: 'Missing or invalid lines array' }, { status: 400 });
            }

            const categorized = await categorizer.categorize(lines as RawReceiptLine[]);

            // Generate summary
            const total = categorized.reduce((sum, item) => sum + item.amount, 0);
            const tax = categorized.reduce((sum, item) => sum + item.taxAmount, 0);

            return NextResponse.json({
                success: true,
                items: categorized,
                summary: {
                    subtotal: total - tax,
                    tax,
                    total,
                    itemCount: categorized.length
                }
            });
        }

        if (action === 'GENERATE_PDF') {
            // In production, this would trigger a PDF generation worker
            return NextResponse.json({
                success: true,
                pdfUrl: `/api/finance/expense/download/${Date.now()}.pdf`
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Expense API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
