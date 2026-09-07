import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Host del Worker que sirve los archivos. Destino del rewrite
// `/storage/files/*`, que se resuelve al COMPILAR: setearlo como env de runtime
// no cambia nada, va como build arg (ver `Dockerfile`).
//
// ⚠️ El fallback es el subdominio `*.workers.dev` de la cuenta, que **lleva el
// nombre del titular** — dato personal en cada URL que se genere con él.
// Mientras esté acá, es sólo una red de contención: el valor real va por
// `CF_WORKER_URL`, apuntando a un dominio propio.
const WORKER_URL =
  process.env.CF_WORKER_URL ??
  'https://casino-uploader.urielalejandrovalle493.workers.dev';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Salida self-contained para dockerizar el web en el VPS: genera
  // .next/standalone con un server mínimo + node_modules trazados. Sin esto la
  // imagen Docker sería enorme. En Vercel es inofensivo (Vercel maneja su
  // propia salida).
  output: 'standalone',
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
        source: '/api/player/:path*',
        destination: `${apiUrl}/player/:path*`,
      },
      {
        source: '/storage/files/:path*',
        destination: `${WORKER_URL}/files/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  silent: !process.env.CI,

  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
