export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
}

export class W3CTracer {
  /**
   * Generates a random 16-byte hex Trace ID and 8-byte hex Span ID.
   */
  public static generateTraceContext(): SpanContext {
    const traceIdBytes = new Uint8Array(16);
    const spanIdBytes = new Uint8Array(8);
    crypto.getRandomValues(traceIdBytes);
    crypto.getRandomValues(spanIdBytes);

    const traceId = Array.from(traceIdBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const spanId = Array.from(spanIdBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      traceId,
      spanId,
      traceFlags: '01', // Sampled
    };
  }

  /**
   * Parses or generates a W3C traceparent header string: 00-{trace-id}-{span-id}-{flags}
   */
  public static parseOrGenerateTraceParent(incomingHeader?: string | null): {
    traceparent: string;
    context: SpanContext;
  } {
    if (incomingHeader && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(incomingHeader)) {
      const parts = incomingHeader.split('-');
      const newSpanIdBytes = new Uint8Array(8);
      crypto.getRandomValues(newSpanIdBytes);
      const newSpanId = Array.from(newSpanIdBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Return new traceparent with propagated traceId but updated parent/span ID
      return {
        traceparent: `00-${parts[1]}-${newSpanId}-${parts[3]}`,
        context: {
          traceId: parts[1],
          spanId: newSpanId,
          traceFlags: parts[3],
        },
      };
    }

    const context = this.generateTraceContext();
    return {
      traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags}`,
      context,
    };
  }

  /**
   * Instruments an asynchronous operation with span telemetry.
   */
  public static async traceOperation<T>(
    operationName: string,
    attributes: Record<string, string | number>,
    fn: () => Promise<T>
  ): Promise<{ result: T; durationMs: number }> {
    const startTime = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - startTime;
      // In production, export span to OTLP collector here
      return { result, durationMs };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      throw error;
    }
  }
}