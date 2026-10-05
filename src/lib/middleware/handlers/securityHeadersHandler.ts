import { type NextRequest } from "next/server";
import { generateCryptographicNonce, generateCsp } from "@/lib/security/csp";
import type { MiddlewareHandler } from "../types";

export const securityHeadersMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  const nonce = generateCryptographicNonce();
  const csp = generateCsp(nonce);

  ctx.nonce = nonce;
  ctx.csp = csp;

  // Next.js reads the nonce from the request's CSP header and applies it to
  // its own inline bootstrap scripts; the layout reads x-csp-nonce.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  requestHeaders.set("x-csp-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  ctx.requestHeaders = requestHeaders;

  const res = await next();
  res.headers.set("Content-Security-Policy", csp);

  return res;
};
