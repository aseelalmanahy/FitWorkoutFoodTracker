import type { NextConfig } from "next";
import { API_HEADERS, BASE_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"],
  async headers() {
    // The page policy and HSTS are in middleware.ts, as they depend on the request and the running environment.
    return [
      { source: "/(.*)", headers: BASE_SECURITY_HEADERS },
      { source: "/api/(.*)", headers: API_HEADERS },
    ];
  },
};

export default nextConfig;
