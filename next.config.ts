import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
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
