import type { NextConfig } from "next";

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

export default nextConfig;
