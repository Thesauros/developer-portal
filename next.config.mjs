/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.THESAUROS_NEXT_DIST || '.next',
  devIndicators: false,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  transpilePackages: [],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async rewrites() {
    const apiBase = process.env.PARTNER_API_URL;
    const monitorBase = process.env.MONITOR_API_URL;
    if (!apiBase) return [];
    return [
      // Real-data proxy: the portal calls /api/v1/real/* same-origin and Next
      // forwards to the deployed Partner API. Same-origin means no browser
      // CORS and no extra CORS config on the backend.
      {
        source: '/api/v1/real/:path*',
        destination: `${apiBase}/api/v1/:path*`,
      },
      // On-chain metrics proxy: /api/v1/monitor/* -> monitoring service /api/*.
      {
        source: '/api/v1/monitor/:path*',
        destination: `${monitorBase || apiBase}/api/:path*`,
      },
      {
        source: '/api/v1/partners/:path*',
        destination: `${apiBase}/api/v1/partners/:path*`,
      },
      {
        source: '/api/v1/partner/:path*',
        destination: `${apiBase}/api/v1/partner/:path*`,
      },
    ];
  },
};

export default nextConfig;
