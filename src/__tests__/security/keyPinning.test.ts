import { validateResponsePin } from '@/lib/security/keyPinning';

describe('KeyPinning Security Module (SPKI Verification)', () => {
  const trustedPin = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';
  const alternativePin = '99887766554433221100ffeeeeddccbbaa99887766554433221100ffeeeeddccbb';

  it('should successfully validate when the server SPKI pin matches expected pins', () => {
    const headers = new Headers({
      'x-spki-sha256': trustedPin,
    });

    const isValid = validateResponsePin(headers, { expectedPins: [trustedPin, alternativePin] });
    expect(isValid).toBe(true);
  });

  it('should throw an error and abort when the SPKI pin header is missing', () => {
    const headers = new Headers({});

    expect(() => {
      validateResponsePin(headers, { expectedPins: [trustedPin] });
    }).toThrow(/Missing public key pinning header/i);
  });

  it('should throw an error and abort when a rogue proxy/CA presents a mismatched pin', () => {
    const rogueProxyPin = 'badcafe1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const headers = {
      'X-SPKI-SHA256': rogueProxyPin,
    };

    expect(() => {
      validateResponsePin(headers, { expectedPins: [trustedPin] });
    }).toThrow(/SPKI pin mismatch.*Aborting reservation signing/i);
  });

  it('should support sha256/ prefix normalization', () => {
    const headers = new Headers({
      'x-spki-sha256': `sha256/${trustedPin}`,
    });

    const isValid = validateResponsePin(headers, { expectedPins: [trustedPin] });
    expect(isValid).toBe(true);
  });
});