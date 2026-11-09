/**
 * route.ts
 * API endpoint to handle image uploads, trigger the WASM OCR pipeline, and return structured metadata.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AmenityClassifier, ExtractedTextBlock } from '@/core/ocr/AmenityClassifier';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;

        if (!file || !file.type.startsWith('image/')) {
            return NextResponse.json({ error: 'Invalid image file' }, { status: 400 });
        }

        // In a real implementation, we would:
        // 1. Send image to the client worker (or process via a server-side WASM runtime like WasmEdge)
        // 2. Receive the ExtractedTextBlock array
        // 3. Pass to AmenityClassifier
        // 4. Call Groq API with the generated prompt

        // Mocking the pipeline for the backend scaffold:
        const mockBlocks: ExtractedTextBlock[] = [
            { text: 'Free WiFi Password: cafe2026', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 100, height: 20 } },
            { text: 'Vegan Avocado Toast - $12', confidence: 0.85, boundingBox: { x: 10, y: 40, width: 150, height: 20 } },
            { text: 'Quiet Zone - No Phone Calls', confidence: 0.95, boundingBox: { x: 10, y: 70, width: 120, height: 20 } }
        ];

        const classifier = new AmenityClassifier();
        const prompt = classifier.generatePrompt(mockBlocks);

        // Mock Groq API call
        const mockLLMResponse = JSON.stringify({
            hasWifi: true,
            hasPowerOutlets: false,
            hasVeganOptions: true,
            hasEspressoMachine: true,
            noiseLevel: 'quiet'
        });

        const amenities = classifier.parseLLMResponse(mockLLMResponse);

        return NextResponse.json({
            success: true,
            amenities,
            rawText: mockBlocks.map(b => b.text).join(' ')
        }, { status: 200 });

    } catch (error) {
        console.error('OCR extraction error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
