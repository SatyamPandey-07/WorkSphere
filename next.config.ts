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
  // Security headers configuration
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' images.unsplash.com res.cloudinary.com data:; connect-src 'self' *.partykit.io https://router.project-osrm.org; frame-ancestors 'none';",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
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
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
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
