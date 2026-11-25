import { type NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { runMiddlewarePipeline } from "@/lib/middleware/chain";
import { isCsrfExemptRoute, middlewareMatcher } from "@/lib/middleware/routes";

export { isCsrfExemptRoute };

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https://*.clerk.accounts.dev",
      "https://*.clerk.com",
      "https://api.mapbox.com",
      "https://events.mapbox.com",
    ],
    "style-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'unsafe-inline'",
      "https://api.mapbox.com",
    ],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://images.unsplash.com",
      "https://res.cloudinary.com",
      "https://img.clerk.com",
      "https://*.clerk.com",
      "https://*.mapbox.com",
    ],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "connect-src": [
      "'self'",
      "https://*.clerk.accounts.dev",
      "https://*.clerk.com",
      "https://api.mapbox.com",
      "https://events.mapbox.com",
      "https://*.tiles.mapbox.com",
      "https://api.devnet.solana.com",
      "https://api.mainnet-beta.solana.com",
      "wss://api.devnet.solana.com",
      "wss://api.mainnet-beta.solana.com",
    ],
    "worker-src": ["'self'", "blob:"],
    "frame-src": [
      "'self'",
      "https://*.clerk.accounts.dev",
      "https://*.clerk.com",
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, values]) =>
      values.length > 0 ? `${key} ${values.join(" ")}` : key,
    )
    .join("; ");
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  return await runMiddlewarePipeline(request, {});
}

export default clerkMiddleware(async (auth, request) => {
  return await runMiddlewarePipeline(request, {
    auth,
    protect: () => auth.protect(),
  });
});

export const config = {
  matcher: middlewareMatcher,
};
