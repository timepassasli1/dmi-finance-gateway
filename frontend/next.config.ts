import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL || "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    // Empty / relative → browser uses Next rewrite proxy (/gw → backend)
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "/gw",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "https://gpzes.com",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://gpzes.com",
    NEXT_PUBLIC_GATEWAY_API_URL: process.env.NEXT_PUBLIC_GATEWAY_API_URL || "https://gpzes.com/gw",
  },
  async redirects() {
    return [
      { source: "/admin/watch-history", destination: "/admin/payments", permanent: false },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/gw/:path*",
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
