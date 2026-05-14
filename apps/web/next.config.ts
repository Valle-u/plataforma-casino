import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El API corre en localhost:3000 (NestJS) — el web en 3001.
  // En dev rewriteamos /api/* → backend para evitar CORS y mantener
  // cookies same-origin si se usan en el futuro.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
