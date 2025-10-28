// next.config.ts

// Manually load variables from .env.local
import dotenv from 'dotenv';
import type { NextConfig } from 'next';

dotenv.config({ path: './.env.local' });

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Fix for pdf-parse trying to load test files
      config.externals = config.externals || [];
      config.externals.push({
        'canvas': 'commonjs canvas'
      });
      
      // Ignore pdf-parse's test directory
      config.module = config.module || {};
      config.module.rules = config.module.rules || [];
      config.module.rules.push({
        test: /pdf\.worker\.(min\.)?js/,
        type: 'asset/resource',
        generator: {
          filename: 'static/worker/[hash][ext][query]'
        }
      });
    }
    return config;
  },
  // Suppress the specific ENOENT warning and externalize pdf-parse
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse']
  }
};

export default nextConfig;