import { ProofOfWorkValidator } from '@/core/ledger/ProofOfWorkValidator';

describe('ProofOfWorkValidator Compact Bits Decoding (#5743)', () => {
    describe('decodeCompactBits', () => {
        it('decodes standard Bitcoin genesis difficulty bits (0x1d00ffff) accurately without integer truncation', () => {
            // bits = 0x1d00ffff: exponent = 0x1d (29), mantissa = 0x00ffff
            // Target = 0x00ffff * 256^(29 - 3) = 0x00ffff * 256^26
            const bits = 0x1d00ffff;
            const target = ProofOfWorkValidator.decodeCompactBits(bits);

            const expectedTargetHex = '00000000ffff0000000000000000000000000000000000000000000000000000';
            const expectedTarget = BigInt('0x' + expectedTargetHex);

            expect(target).toBe(expectedTarget);
            expect(target > 0n).toBe(true);
        });

        it('handles large exponents exceeding 30 bytes without floating-point / integer truncation', () => {
            // bits = 0x207fffff: exponent = 0x20 (32 bytes), mantissa = 0x7fffff
            // Exponent 32 > 30 bytes
            const bits = 0x207fffff;
            const target = ProofOfWorkValidator.decodeCompactBits(bits);

            // Mantissa shifted by (32 - 3) = 29 bytes (232 bits)
            const expectedTarget = BigInt(0x7fffff) << BigInt(8 * 29);
            expect(target).toBe(expectedTarget);
            expect(target > (1n << 240n)).toBe(true);
        });

        it('handles small exponents (exponent <= 3) with right shift division', () => {
            // bits = 0x03123456: exponent = 3, mantissa = 0x123456
            // Target = 0x123456 * 256^0 = 0x123456
            const bits3 = 0x03123456;
            expect(ProofOfWorkValidator.decodeCompactBits(bits3)).toBe(BigInt(0x123456));

            // bits = 0x02123456: exponent = 2, mantissa = 0x123456 >> 8 = 0x1234
            const bits2 = 0x02123456;
            expect(ProofOfWorkValidator.decodeCompactBits(bits2)).toBe(BigInt(0x1234));

            // bits = 0x01123456: exponent = 1, mantissa = 0x123456 >> 16 = 0x12
            const bits1 = 0x01123456;
            expect(ProofOfWorkValidator.decodeCompactBits(bits1)).toBe(BigInt(0x12));
        });

        it('handles sign bit edge cases and negative targets by returning 0n', () => {
            // Sign bit is 0x00800000 (e.g. bits = 0x1d800001)
            const negativeBits = 0x1d800001;
            expect(ProofOfWorkValidator.decodeCompactBits(negativeBits)).toBe(0n);
        });

        it('returns 0n when mantissa or exponent is zero', () => {
            expect(ProofOfWorkValidator.decodeCompactBits(0x00000000)).toBe(0n);
            expect(ProofOfWorkValidator.decodeCompactBits(0x1d000000)).toBe(0n);
            expect(ProofOfWorkValidator.decodeCompactBits(0x00123456)).toBe(0n);
        });

        it('clamps boundary targets exceeding 256 bits to maximum 256-bit unsigned integer', () => {
            // Extremely large exponent e.g. 0x25 (37 bytes)
            const giantBits = 0x257fffff;
            const target = ProofOfWorkValidator.decodeCompactBits(giantBits);
            const max256 = (1n << 256n) - 1n;
            expect(target).toBe(max256);
        });
    });

    describe('validateHashTarget', () => {
        const bits = 0x1d00ffff;
        const validHash = '0000000000000000000000000000000000000000000000000000000000000001';
        const invalidHash = '0000000100000000000000000000000000000000000000000000000000000000';

        it('returns true when hash integer is less than or equal to target', () => {
            expect(ProofOfWorkValidator.validateHashTarget(validHash, bits)).toBe(true);
        });

        it('returns false when hash integer exceeds difficulty target', () => {
            expect(ProofOfWorkValidator.validateHashTarget(invalidHash, bits)).toBe(false);
        });

        it('handles 0x prefixed hex strings cleanly', () => {
            expect(ProofOfWorkValidator.validateHashTarget('0x' + validHash, bits)).toBe(true);
        });

        it('returns false for invalid hex input gracefully', () => {
            expect(ProofOfWorkValidator.validateHashTarget('invalid-hex', bits)).toBe(false);
            expect(ProofOfWorkValidator.validateHashTarget('', bits)).toBe(false);
        });
    });
});
