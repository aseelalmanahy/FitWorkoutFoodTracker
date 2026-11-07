import type { NextConfig } from "next";
import { API_HEADERS, BASE_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // tesseract.js runs a worker thread from its own files in node_modules, so it isn't bundled.
  // tesseract.js and transformers.js run native or worker code from their own files in node_modules, so neither is bundled.
  serverExternalPackages: ["@node-rs/argon2", "tesseract.js", "@huggingface/transformers", "onnxruntime-node"],
  async headers() {
    // The page policy and HSTS are in middleware.ts, as they depend on the request and the running environment.
    return [
      { source: "/(.*)", headers: BASE_SECURITY_HEADERS },
      { source: "/api/(.*)", headers: API_HEADERS },
    ];
  },
};

export default nextConfig;
