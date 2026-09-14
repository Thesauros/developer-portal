import { marketingHref, documentationHref } from "./lib/site-links.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.THESAUROS_NEXT_DIST || ".next",
  devIndicators: false,
  // Routes are native at /app, /api and /monitoring on every deployment.
  // NEXT_PUBLIC_BASE_PATH from older deployments is intentionally ignored.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async redirects() {
    return [
      {
        source: "/customer/:path*",
        destination: "/app/:path*",
        permanent: true,
      },
      {
        source: "/developers/customer/:path*",
        destination: "/app/:path*",
        permanent: true,
      },
      {
        source: "/developers/api/:path*",
        destination: "/api/:path*",
        permanent: true,
      },
      {
        source: "/developers/monitoring/:path*",
        destination: "/monitoring/:path*",
        permanent: true,
      },
      {
        source: "/developers",
        destination: "/app/institution",
        permanent: true,
      },
      {
        source: "/contact",
        destination: marketingHref("/contact"),
        permanent: false,
      },
      {
        source: "/docs/:path*",
        destination: documentationHref("/:path*"),
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
