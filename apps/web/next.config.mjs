const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const dev = process.env.NODE_ENV !== 'production';

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // No page uses next/image; with optimization off, /_next/image never decodes anything.
  images: { unoptimized: true },
  // In production Caddy routes /api before it reaches Next, so the rewrite exists only for local dev.
  // Leaving it out of production also leaves Next no external destination to proxy to.
  async rewrites() {
    return dev ? [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }] : [];
  },
};
