import crypto from 'crypto';

export interface PinValidationOptions {
  expectedPins: string[]; // Array of valid SHA-256 SPKI fingerprint hashes (hex or base64)
  headerName?: string;    // Custom header name containing the server's SPKI pin (default: 'x-spki-sha256')
}

/**
 * Validates Subject Public Key Info (SPKI) SHA-256 fingerprint from response headers
 * against trusted official WorkSphere booking notary pins to prevent MITM interception.
 */
export function validateResponsePin(
  responseHeaders: Headers | Record<string, string>,
  options: PinValidationOptions
): boolean {
  const headerName = (options.headerName || 'x-spki-sha256').toLowerCase();
  
  let serverPin: string | null = null;
  if (responseHeaders instanceof Headers) {
    serverPin = responseHeaders.get(headerName);
  } else {
    // Handle plain object headers case-insensitively
    const matchedKey = Object.keys(responseHeaders).find(
      k => k.toLowerCase() === headerName
    );
    if (matchedKey) {
      serverPin = responseHeaders[matchedKey];
    }
  }

  if (!serverPin) {
    throw new Error('SECURITY ERROR: Missing public key pinning header in notary response. Potential MITM proxy detected.');
  }

  // Normalize server pin (remove sha256/ prefix if present)
  const normalizedServerPin = serverPin.replace(/^sha256\/+/i, '').trim().toLowerCase();

  const isPinned = options.expectedPins.some(pin => {
    const normalizedExpected = pin.replace(/^sha256\/+/i, '').trim().toLowerCase();
    return normalizedServerPin === normalizedExpected;
  });

  if (!isPinned) {
    throw new Error(`SECURITY ALERT: SPKI pin mismatch! Server fingerprint [${serverPin}] does not match trusted WorkSphere notary pins. Aborting reservation signing.`);
  }

  return true;
}

/**
 * Higher-order fetch wrapper enforcing SPKI public key pinning for notary endpoints.
 */
export async function pinnedFetch(
  url: string,
  init: RequestInit = {},
  options: PinValidationOptions
): Promise<Response> {
  const response = await fetch(url, init);

  // Validate SPKI pin before allowing sensitive payload consumption / signing
  validateResponsePin(response.headers, options);

  return response;
}