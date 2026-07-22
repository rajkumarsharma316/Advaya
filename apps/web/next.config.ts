import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'node-datachannel': false,
      };
    }
    return config;
  },
  experimental: {
    turbo: {
      resolveAlias: {
        'node-datachannel': false,
      },
    },
  },
};

export default nextConfig;
