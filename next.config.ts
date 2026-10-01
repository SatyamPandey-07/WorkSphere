import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "*.lhr.life",
    "*.loca.lt",
    "*.ngrok-free.app",
    "*.pinggy.io",
  ],
  // TypeScript strict checking enabled — do not add ignoreBuildErrors: true
  // OSRM routing proxy configuration
  async rewrites() {
    const osrmUrl =
      process.env.NEXT_PUBLIC_OSRM_URL || "https://router.project-osrm.org";
    return [
      {
        source: "/osrm/:path*",
        destination: `${osrmUrl}/:path*`,
      },
    ];
  },
  // Security headers. The Content-Security-Policy is set per request (with a
  // nonce) in src/middleware.ts, so it is intentionally not duplicated here —
  // two CSP headers are intersected by browsers and would block map tiles,
  // avatars and Clerk.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(self)",
          },
        ],
      },
    ];
  },
  // Allow external images from Unsplash (FREE, no card required)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "source.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.pexels.com",
        pathname: "/**",
      },
    ],
  },
  // Webpack config for serverless compatibility
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias.canvas = false;
      config.resolve.alias.encoding = false;
    }
    return config;
  },
  // Use turbopack config (Next.js 16 default)
  turbopack: {},
};

export default nextConfig;
