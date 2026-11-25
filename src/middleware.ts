import { NextRequest, NextResponse } from 'next/server';

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      'https://*.clerk.accounts.dev',
      'https://*.clerk.com',
      'https://api.mapbox.com',
      'https://events.mapbox.com',
    ],
    'style-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'unsafe-inline'",
      'https://api.mapbox.com',
    ],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://images.unsplash.com',
      'https://res.cloudinary.com',
      'https://img.clerk.com',
      'https://*.clerk.com',
      'https://*.mapbox.com',
    ],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'connect-src': [
      "'self'",
      'https://*.clerk.accounts.dev',
      'https://*.clerk.com',
      'https://api.mapbox.com',
      'https://events.mapbox.com',
      'https://*.tiles.mapbox.com',
      'https://api.devnet.solana.com',
      'https://api.mainnet-beta.solana.com',
      'wss://api.devnet.solana.com',
      'wss://api.mainnet-beta.solana.com',
    ],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': [
      "'self'",
      'https://*.clerk.accounts.dev',
      'https://*.clerk.com',
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length > 0 ? `${key} ${values.join(' ')}` : key))
    .join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = generateCspNonce();
  const cspHeader = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('x-nonce', nonce);
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
