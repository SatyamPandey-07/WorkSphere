/**
 * WebAuthnService.test.ts
 * Unit tests for the WebAuthnService class.
 */

import { WebAuthnService } from '@/lib/auth/WebAuthnService';

describe('WebAuthnService', () => {
    let service: WebAuthnService;

    beforeEach(() => {
        service = new WebAuthnService('/mock/api');
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('should fetch registration options successfully', async () => {
        const mockOptions = { challenge: 'abc', rp: { name: 'Test', id: 'test.com' }, user: { id: '123', name: 'test', displayName: 'test' }, pubKeyCredParams: [], timeout: 60000, attestation: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } };
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => mockOptions,
        });

        const options = await service.getRegistrationOptions();
        expect(options).toEqual(mockOptions);
    });

    it('should throw error if registration is cancelled by user', async () => {
        const mockOptions = { challenge: 'abc', rp: { name: 'Test', id: 'test.com' }, user: { id: '123', name: 'test', displayName: 'test' }, pubKeyCredParams: [], timeout: 60000, attestation: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } };

        (global.navigator.credentials as any) = {
            create: jest.fn().mockRejectedValue({ name: 'NotAllowedError', message: 'Cancelled' })
        };

        await expect(service.createPasskey(mockOptions)).rejects.toThrow('Passkey registration was cancelled or denied by the user.');
    });

    it('should correctly convert base64url to ArrayBuffer', () => {
        const base64url = 'abc_123';
        const buffer = (service as any).base64UrlToArrayBuffer(base64url);
        expect(buffer).toBeInstanceOf(ArrayBuffer);
        expect(buffer.byteLength).toBeGreaterThan(0);
    });
});
