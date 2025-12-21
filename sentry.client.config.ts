import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  
  // Session Replay (optional)
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Enable debug in development
  debug: process.env.NODE_ENV === "development",

  // Filter out non-critical errors
  beforeSend(event, hint) {
    // Don't send errors in development unless DSN is set
    if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
      return null;
    }

    // Filter out specific errors
    const error = hint.originalException as Error;
    if (error?.message?.includes("Network request failed")) {
      return null; // Don't report network errors
    }

    return event;
  },

  // Set environment
  environment: process.env.NODE_ENV,
});
