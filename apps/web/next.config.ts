import type { NextConfig } from 'next';

const WORKER_URL = process.env.CF_WORKER_URL ?? 'https://casino-uploader.urielalejandrovalle493.workers.dev';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
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
