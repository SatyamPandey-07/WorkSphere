/**
 * PDF Generation Worker
 * Offloads heavy binary manipulation and image compression required for PDF generation.
 */

import { ItineraryPdfRenderer, ItineraryData } from '@/core/pdf/ItineraryPdfRenderer';
import { PassGenerator, PassData } from '@/core/wallet/PassGenerator';

const pdfRenderer = new ItineraryPdfRenderer();
const passGenerator = new PassGenerator(
    'pass.com.worksphere.booking',
    'ABCDE12345'
);

self.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data;

    try {
        if (action === 'GENERATE_PDF') {
            const pdfBytes = await pdfRenderer.generate(payload as ItineraryData);

            // Transfer buffer back to main thread efficiently
            self.postMessage(
                { action: 'PDF_GENERATED', data: pdfBytes },
                [pdfBytes.buffer] // Transferable object
            );
        }

        if (action === 'GENERATE_PKPASS') {
            const { data, assets } = payload;
            const pkPassBuffer = await passGenerator.createPkPassArchive(data as PassData, assets);

            self.postMessage(
                { action: 'PKPASS_GENERATED', data: pkPassBuffer },
                [pkPassBuffer.buffer]
            );
        }
    } catch (error: any) {
        self.postMessage({ action: 'ERROR', error: error.message });
    }
});

export { };
