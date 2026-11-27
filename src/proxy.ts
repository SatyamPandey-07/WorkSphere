import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import type { MiddlewareContext } from "@/lib/middleware/types";
import { runMiddlewarePipeline } from "@/lib/middleware/chain";

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

function addSecurityHeaders(
  response: NextResponse,
  nonce: string,
  cspHeader: string,
): NextResponse {
  response.headers.set("x-nonce", nonce);
  response.headers.set("x-csp-nonce", nonce);
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

const clerkMiddlewareHandler = clerkMiddleware(async (auth, request) => {
  const nonce = request.headers.get("x-nonce") || generateCspNonce();
  const cspHeader =
    request.headers.get("Content-Security-Policy") ||
    buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const context: MiddlewareContext = {
    auth: async () => {
      const authState = await auth();
      return {
        userId: authState.userId ?? null,
        sessionClaims: authState.sessionClaims ?? null,
      };
    },
    protect: () => auth.protect(),
    nonce,
    csp: cspHeader,
    requestHeaders,
  };

  return await runMiddlewarePipeline(request, context);
});

export async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<NextResponse> {
  const nonce = generateCspNonce();
  const cspHeader = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const requestWithNonce = new NextRequest(request, { headers: requestHeaders });
  const response = await clerkMiddlewareHandler(requestWithNonce, event);

  return addSecurityHeaders(response, nonce, cspHeader);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot|css|js|json|txt|xml|webmanifest)|manifest\\.json|sw\\.js|service-worker\\.js|robots\\.txt).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
