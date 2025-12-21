import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Use webpack mode instead of turbopack for dev
  webpack: (config) => {
    // Ensure Prisma client works properly
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

// Sentry configuration
const sentryConfig = {
  // Suppresses source map uploading logs during build
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Upload source maps to Sentry
  widenClientFileUpload: true,
  // Hide source maps from client bundles
  hideSourceMaps: true,
  // Disable Sentry in development unless DSN is set
  disableLogger: true,
};

export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryConfig)
  : nextConfig;
