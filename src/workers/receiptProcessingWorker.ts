/**
 * Receipt Processing Worker
 * Processes the image buffer through the WASM pipeline and handles the heavy CSV/PDF compilation off-thread.
 */

import { initReceiptWasm, processImage } from '../lib/wasm-loader/receipt';

interface ProcessRequest {
    type: 'PROCESS_RECEIPT';
    imageBuffer: ArrayBuffer;
    width: number;
    height: number;
}

interface ProcessResult {
    type: 'PROCESS_COMPLETE';
    lines: Array<{ text: string; isTotalZone: boolean; confidence: number }>;
    csvData: string;
}

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
    if (event.data.type === 'PROCESS_RECEIPT') {
        try {
            await initReceiptWasm();

            const { imageBuffer, width, height } = event.data;

            // 1. Run WASM layout analysis
            const components = processImage(new Uint8Array(imageBuffer), width, height);

            // 2. Mock OCR extraction based on component bounding boxes
            // In a real app, we'd pass these boxes to Tesseract.js or a cloud OCR
            const lines = components.map((c, i) => ({
                text: `Mocked OCR Line ${i + 1} - $${(Math.random() * 20).toFixed(2)}`,
                isTotalZone: c.type === 2,
                confidence: 0.95
            }));

            // 3. Generate CSV preview
            const csvData = generateCSV(lines);

            const result: ProcessResult = {
                type: 'PROCESS_COMPLETE',
                lines,
                csvData
            };

            self.postMessage(result);
        } catch (error) {
            self.postMessage({ type: 'PROCESS_ERROR', error: String(error) });
        }
    }
};

function generateCSV(lines: Array<{ text: string; isTotalZone: boolean }>): string {
    let csv = 'Line,Type,Amount\n';
    lines.forEach((l, i) => {
        const match = l.text.match(/\$(\d+\.\d{2})/);
        const amount = match ? match[1] : '0.00';
        csv += `"${l.text}",${l.isTotalZone ? 'TOTAL' : 'ITEM'},${amount}\n`;
    });
    return csv;
}

export { };
