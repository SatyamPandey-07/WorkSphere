import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow external images from Yelp
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3-media*.yelpcdn.com',
        pathname: '/bphoto/**',
      },
      {
        protocol: 'https',
        hostname: '*.yelpcdn.com',
        pathname: '/**',
      },
    ],
  },
  // Use turbopack config (Next.js 16 default)
  turbopack: {},
};

export default nextConfig;
