import type { NextConfig } from 'next';

const WORKER_URL = process.env.CF_WORKER_URL ?? 'https://casino-uploader.urielalejandrovalle493.workers.dev';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    return [
      {
        source: '/api/tenant/:path*',
        destination: `${apiUrl}/tenant/:path*`,
      },
      {
        source: '/storage/files/:path*',
        destination: `${WORKER_URL}/files/:path*`,
      },
    ];
  },
};

export default nextConfig;
