import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteDirectory = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  agentRules: false,
  turbopack: {
    root: resolve(websiteDirectory, ".."),
  },
  outputFileTracingRoot: resolve(websiteDirectory, ".."),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      },
      {
        protocol: "https",
        hostname: "github.com"
      }
    ]
  }
};

export default nextConfig;
