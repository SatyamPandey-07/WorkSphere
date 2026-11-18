import {
  PDFSignerEngine,
  SignerIdentity,
  TimestampToken,
} from '../../core/pdf/PDFSignerEngine';

describe('PDFSignerEngine', () => {
  let keyPair: { privateKeyPem: string; publicKeyPem: string };
  let signer: SignerIdentity;
  const mockPdfContent = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 72 712 Td (WorkSphere Agreement) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF
`;

  beforeAll(() => {
    keyPair = PDFSignerEngine.generateKeyPair();
    signer = {
      commonName: 'Alice Developer',
      organization: 'WorkSphere Corp',
      email: 'alice@worksphere.io',
      privateKeyPem: keyPair.privateKeyPem,
      publicKeyPem: keyPair.publicKeyPem,
    };
  });

  describe('KeyPair Generation', () => {
    it('generates valid RSA public and private key PEM strings', () => {
      expect(keyPair.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
      expect(keyPair.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
    });
  });

  describe('PAdES ByteRange Signing & Verification', () => {
    it('signs raw PDF and produces verifiable ISO 32000-1 signature dictionary', () => {
      const rawPdfBuffer = Buffer.from(mockPdfContent, 'latin1');
      const signResult = PDFSignerEngine.signPdf(rawPdfBuffer, signer, {
        reason: 'Office Desk Lease Agreement',
        location: 'Bengaluru Co-Working Hub',
      });

      expect(signResult.signedPdfBytes).toBeDefined();
      expect(signResult.signedPdfBytes.length).toBeGreaterThan(rawPdfBuffer.length);
      expect(signResult.signatureHex.length).toBeGreaterThan(100);
      expect(signResult.byteRange[0]).toBe(0);

      // Verify the signed PDF
      const verifyResult = PDFSignerEngine.verifyPdf(
        signResult.signedPdfBytes,
        signer.publicKeyPem
      );

      expect(verifyResult.isValid).toBe(true);
      expect(verifyResult.signerName).toBe('Alice Developer');
      expect(verifyResult.signatureVerified).toBe(true);
      expect(verifyResult.documentDigestMatch).toBe(true);
    });

    it('detects tampering when content inside the ByteRange is altered', () => {
      const rawPdfBuffer = Buffer.from(mockPdfContent, 'latin1');
      const signResult = PDFSignerEngine.signPdf(rawPdfBuffer, signer);

      // Tamper: alter a byte in the first segment
      const tamperedBuffer = Buffer.from(signResult.signedPdfBytes);
      tamperedBuffer[50] = tamperedBuffer[50] ^ 0xff; // Flip bits

      const verifyResult = PDFSignerEngine.verifyPdf(
        tamperedBuffer,
        signer.publicKeyPem
      );

      expect(verifyResult.isValid).toBe(false);
      expect(verifyResult.signatureVerified).toBe(false);
    });

    it('fails verification when verified with an untrusted or mismatched public key', () => {
      const rawPdfBuffer = Buffer.from(mockPdfContent, 'latin1');
      const signResult = PDFSignerEngine.signPdf(rawPdfBuffer, signer);

      // Generate a completely different untrusted key pair
      const attackerKeys = PDFSignerEngine.generateKeyPair();

      const verifyResult = PDFSignerEngine.verifyPdf(
        signResult.signedPdfBytes,
        attackerKeys.publicKeyPem
      );

      expect(verifyResult.isValid).toBe(false);
      expect(verifyResult.signatureVerified).toBe(false);
    });
  });

  describe('RFC 3161 Timestamp Token Integration', () => {
    it('binds timestamp token and verifies both signature and timestamp integrity', () => {
      const rawPdfBuffer = Buffer.from(mockPdfContent, 'latin1');
      const mockTsaToken: TimestampToken = {
        tsaName: 'DigiCert Global Timestamping Authority',
        timestamp: Date.now(),
        nonce: 'nonce-12345678',
        digestSha256: 'deadbeef12345678',
        signature: 'abcdef1234567890abcdef1234567890',
      };

      const signResult = PDFSignerEngine.signPdf(
        rawPdfBuffer,
        signer,
        { reason: 'Statutory Employment NDA' },
        mockTsaToken
      );

      const verifyResult = PDFSignerEngine.verifyPdf(
        signResult.signedPdfBytes,
        signer.publicKeyPem,
        mockTsaToken
      );

      expect(verifyResult.isValid).toBe(true);
      expect(verifyResult.hasTimestampToken).toBe(true);
      expect(verifyResult.timestampValid).toBe(true);
    });
  });
});
