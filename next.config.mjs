/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.THESAUROS_NEXT_DIST || '.next',
  devIndicators: false,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  transpilePackages: [],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
