# OpenTelemetry Distributed Tracing Integration Guide

This guide explains how to add OpenTelemetry distributed tracing to WorkSphere API routes, including installing the SDK, creating spans, tagging attributes, and configuring exporters.

---

## 1. Installation

Install the core SDK and the HTTP/Fetch instrumentations:

```bash
npm install @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

---

## 2. Bootstrap the SDK

Create `instrumentation.ts` in the project root (Next.js loads this automatically via `experimental.instrumentationHook`):

```ts
// instrumentation.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: "worksphere",
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
        headers: {
          Authorization: process.env.OTEL_EXPORTER_AUTH_HEADER ?? "",
        },
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });
    sdk.start();
  }
}
```

Enable the hook in `next.config.ts`:

```ts
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};
export default nextConfig;
```

---

## 3. Environment Variables

Add to `.env.local`:

```env
# OTLP collector endpoint (Jaeger, Grafana Tempo, Honeycomb, etc.)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Optional: auth header for cloud providers (e.g. "Bearer <token>")
OTEL_EXPORTER_AUTH_HEADER=

# Sampling rate (1.0 = trace everything; 0.1 = 10% of requests)
OTEL_TRACES_SAMPLER=parentbased_always_on
```

---

## 4. Creating Spans in API Routes

Import the tracer and wrap business logic in custom spans for fine-grained tracing:

```ts
// src/lib/tracer.ts
import { trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("worksphere", "1.0.0");
```

```ts
// src/app/api/venues/route.ts
import { tracer } from "@/lib/tracer";
import { SpanStatusCode } from "@opentelemetry/api";

export async function GET(req: Request) {
  return tracer.startActiveSpan("venues.list", async (span) => {
    try {
      const { searchParams } = new URL(req.url);
      const city = searchParams.get("city") ?? "all";

      // Tag span with request attributes
      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/venues",
        "venues.filter.city": city,
      });

      const venues = await db.venue.findMany({ where: { city } });

      span.setAttributes({ "venues.result.count": venues.length });
      span.setStatus({ code: SpanStatusCode.OK });

      return Response.json({ venues });
    } catch (err: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : "Unknown error",
      });
      span.recordException(err as Error);
      return Response.json({ error: "Failed to fetch venues" }, { status: 500 });
    } finally {
      span.end();
    }
  });
}
```

---

## 5. Semantic Attribute Conventions

Use standard attribute names from the OpenTelemetry semantic conventions to ensure compatibility with dashboards and alerting:

| Attribute | Example value | Meaning |
|-----------|---------------|---------|
| `http.method` | `"GET"` | HTTP verb |
| `http.route` | `"/api/venues"` | Matched route pattern |
| `http.status_code` | `200` | Response status |
| `db.system` | `"postgresql"` | Database type |
| `db.statement` | `"SELECT * FROM venues"` | SQL (redact PII) |
| `user.id` | `"user_abc123"` | Authenticated user |
| `venues.filter.city` | `"San Francisco"` | Domain-specific filter |

---

## 6. Running a Local Collector (Jaeger)

Use Jaeger all-in-one for local development tracing:

```bash
docker run -d \
  --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then open `http://localhost:16686` in your browser. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces` in `.env.local`.

---

## 7. Cloud Exporters

| Provider | OTLP Endpoint | Auth header |
|----------|--------------|-------------|
| Grafana Cloud Tempo | `https://tempo-otlp.grafana.net/otlp/v1/traces` | `Basic <base64(instanceId:token)>` |
| Honeycomb | `https://api.honeycomb.io/v1/traces` | `x-honeycomb-team: <api-key>` |
| Datadog | `https://trace.agent.datadoghq.com/v0.4/traces` | `DD-API-KEY: <api-key>` |

Configure via the `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_AUTH_HEADER` env vars.
