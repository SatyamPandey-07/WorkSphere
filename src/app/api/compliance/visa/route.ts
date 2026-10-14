import { NextRequest, NextResponse } from 'next/server';
import { DocumentDataExtractor } from '@/core/ai/DocumentDataExtractor';
import { VisaFormFiller, FormFieldMapping } from '@/core/compliance/VisaFormFiller';

const extractor = new DocumentDataExtractor(process.env.GROQ_API_KEY || 'mock_key');

const standardMappings: FormFieldMapping[] = [
    { pdfFieldName: 'full_name', dataSourceKey: 'fullName', type: 'text' },
    { pdfFieldName: 'passport_no', dataSourceKey: 'passportNumber', type: 'text' },
    { pdfFieldName: 'income_usd', dataSourceKey: 'monthlyIncome', type: 'text', transform: (v) => String(v) },
    { pdfFieldName: 'employer_name', dataSourceKey: 'remoteEmployer', type: 'text' },
    { pdfFieldName: 'agreement_check', dataSourceKey: 'termsAccepted', type: 'checkbox' }
];

const filler = new VisaFormFiller(standardMappings);

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const documentText = formData.get('documentText') as string;
        const targetCountry = formData.get('targetCountry') as string;

        if (!documentText || !targetCountry) {
            return NextResponse.json({ error: 'Missing document text or target country' }, { status: 400 });
        }

        // 1. Extract data using AI
        const schema = `{ "fullName": "string", "passportNumber": "string", "monthlyIncome": "number", "remoteEmployer": "string" }`;
        const extractionResult = await extractor.extractFromText(documentText, schema);

        if (!extractionResult.success) {
            return NextResponse.json({ error: 'Failed to extract data from document' }, { status: 422 });
        }

        // 2. Generate fill instructions
        const instructions = filler.generateFillInstructions(extractionResult.data);

        // 3. Validate
        const missing = filler.validateRequiredFields(extractionResult.data);
        if (missing.length > 0) {
            return NextResponse.json({
                warning: 'Missing required fields',
                missingFields: missing,
                instructions: Object.fromEntries(instructions)
            }, { status: 200 });
        }

        // 4. Return instructions to client (Client will pass to PDF Worker)
        return NextResponse.json({
            success: true,
            country: targetCountry,
            extractedData: extractionResult.data,
            fillInstructions: Object.fromEntries(instructions)
        });

    } catch (error) {
        console.error('Visa API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
