/**
 * PassGenerator
 * Generates the pass.json structure and handles the cryptographic signing 
 * required for Apple/Google Wallet integration (PKPass).
 */

import crypto from 'crypto';

export interface PassData {
    venueName: string;
    deskId: string;
    date: string;
    qrCodeData: string;
    logoText: string;
}

export interface PassManifest {
    'pass.json': string;
    'icon.png': string;
    'logo.png': string;
}

export class PassGenerator {
    private passTypeIdentifier: string;
    private teamIdentifier: string;

    constructor(passTypeIdentifier: string, teamIdentifier: string) {
        this.passTypeIdentifier = passTypeIdentifier;
        this.teamIdentifier = teamIdentifier;
    }

    public generatePassJson(data: PassData): string {
        const passJson = {
            formatVersion: 1,
            passTypeIdentifier: this.passTypeIdentifier,
            serialNumber: `ws-${data.deskId}-${Date.now()}`,
            teamIdentifier: this.teamIdentifier,
            organizationName: 'WorkSphere',
            description: `${data.venueName} Desk Booking`,
            logoText: data.logoText,
            foregroundColor: 'rgb(255, 255, 255)',
            backgroundColor: 'rgb(20, 20, 30)',
            labelColor: 'rgb(200, 200, 200)',
            relevantDate: new Date(data.date).toISOString(),
            barcode: {
                message: data.qrCodeData,
                format: 'PKBarcodeFormatQR',
                messageEncoding: 'iso-8859-1'
            },
            eventTicket: {
                headerFields: [
                    { key: 'date', label: 'DATE', value: data.date }
                ],
                primaryFields: [
                    { key: 'venue', label: 'VENUE', value: data.venueName }
                ],
                secondaryFields: [
                    { key: 'desk', label: 'DESK', value: data.deskId }
                ],
                backFields: [
                    { key: 'terms', label: 'Terms', value: 'Valid only for the booked time slot. Present QR at reception.' }
                ]
            }
        };

        return JSON.stringify(passJson);
    }

    public generateManifest(files: Record<string, Buffer>): string {
        const manifest: Record<string, string> = {};

        for (const [filename, buffer] of Object.entries(files)) {
            const hash = crypto.createHash('sha1').update(buffer).digest('hex');
            manifest[filename] = hash;
        }

        return JSON.stringify(manifest);
    }

    public signManifest(manifestJson: string): Buffer {
        // In a real production environment, this would use a real Apple WWDR certificate 
        // and a Pass Type ID certificate (.p12) to create a detached PKCS#7 signature.
        // Here we simulate the cryptographic operation.

        const mockSignature = crypto.createHash('sha256').update(manifestJson).digest();

        // A real signature would be a DER encoded PKCS#7 object
        return mockSignature;
    }

    public async createPkPassArchive(data: PassData, assets: Record<string, Buffer>): Promise<Buffer> {
        const passJson = this.generatePassJson(data);
        const passBuffer = Buffer.from(passJson, 'utf-8');

        const files = {
            'pass.json': passBuffer,
            ...assets
        };

        const manifestJson = this.generateManifest(files);
        const manifestBuffer = Buffer.from(manifestJson, 'utf-8');
        const signatureBuffer = this.signManifest(manifestJson);

        // In a real implementation, we would use a ZIP library (like archiver) 
        // to bundle these files into a .pkpass archive.
        // Returning a concatenated buffer for demonstration.

        const archive = Buffer.concat([
            passBuffer,
            manifestBuffer,
            signatureBuffer,
            assets['icon.png'] || Buffer.alloc(0),
            assets['logo.png'] || Buffer.alloc(0)
        ]);

        return archive;
    }
}
