import type { NextConfig } from 'next';

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
        destination: `${apiUrl}/storage/files/:path*`,
      },
    ];
  },
};

export default nextConfig;
