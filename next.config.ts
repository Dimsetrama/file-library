// next.config.ts

// Manually load variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;