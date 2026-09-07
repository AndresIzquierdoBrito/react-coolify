import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@izbri/contracts"],
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/media/:path*", destination: `${api}/media/:path*` },
      { source: "/healthz", destination: `${api}/healthz` }
    ];
  }
};

export default nextConfig;
