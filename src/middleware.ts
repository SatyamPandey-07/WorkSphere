import { NextRequest, NextResponse } from 'next/server';
import { W3CTracer } from '@/lib/telemetry/tracer';

export function middleware(request: NextRequest) {
  const incomingTraceParent = request.headers.get('traceparent');
  const { traceparent, context } = W3CTracer.parseOrGenerateTraceParent(incomingTraceParent);

  // Clone request headers to inject trace context for downstream handlers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('traceparent', traceparent);
  requestHeaders.set('x-trace-id', context.traceId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Attach W3C traceparent to outgoing response headers for end-to-end correlation
  response.headers.set('traceparent', traceparent);
  response.headers.set('tracestate', `worksphere=vendor:active,tid:${context.traceId}`);

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/venues/:path*'],
};