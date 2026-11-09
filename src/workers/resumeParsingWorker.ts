/**
 * resumeParsingWorker.ts
 * Web Worker to handle the heavy text processing and chunking of large PDF/DOCX resume uploads off the main thread.
 * Prevents UI freezing during file reading and initial text extraction.
 */

export interface ParsingWorkerMessage {
    type: 'PARSE_TEXT' | 'ERROR' | 'SUCCESS';
    payload?: string | unknown;
    error?: string;
}

// Mock text extraction function (in production, use pdf.js or mammoth.js)
const extractTextFromBuffer = async (buffer: ArrayBuffer, fileType: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (fileType === 'application/pdf' || fileType === 'text/plain') {
                // Simulate extracted text
                resolve('John Doe\nSoftware Engineer\nSkills: TypeScript, React, Node.js, PostgreSQL\nExperience: 5 years building scalable web applications.');
            } else {
                reject(new Error('Unsupported file type.'));
            }
        }, 1500); // Simulate processing delay
    });
};

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'PARSE_TEXT') {
        try {
            const { buffer, fileType } = payload as { buffer: ArrayBuffer; fileType: string };

            self.postMessage({ type: 'PARSE_TEXT', payload: 'Processing file...' } as ParsingWorkerMessage);

            const extractedText = await extractTextFromBuffer(buffer, fileType);

            self.postMessage({
                type: 'SUCCESS',
                payload: extractedText
            } as ParsingWorkerMessage);
        } catch (error) {
            self.postMessage({
                type: 'ERROR',
                error: error instanceof Error ? error.message : 'Unknown error during text extraction.'
            } as ParsingWorkerMessage);
        }
    }
};