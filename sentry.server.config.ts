import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Enable debug in development
  debug: process.env.NODE_ENV === "development",

  // Filter out non-critical errors
  beforeSend(event, hint) {
    // Don't send errors in development unless DSN is set
    if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
      return null;
    }

    return event;
  },

  // Set environment
  environment: process.env.NODE_ENV,
});
