const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';

export default {
  reactStrictMode: true,
  // In production Caddy routes /api before it reaches Next; this rewrite serves local dev.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};
