import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow external images from Foursquare
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fastly.4sqi.net',
        pathname: '/img/**',
      },
      {
        protocol: 'https',
        hostname: 'ss3.4sqi.net',
        pathname: '/img/**',
      },
    ],
  },
  // Use turbopack config (Next.js 16 default)
  turbopack: {},
};

export default nextConfig;
