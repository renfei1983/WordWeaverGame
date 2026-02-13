/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/wordweaver',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8002/:path*',
      },
    ]
  },
  // Increase timeout for API routes (default is often too short for AI generation)
  experimental: {
    proxyTimeout: 120000, // 120 seconds (2 minutes)
  },
}

module.exports = nextConfig
