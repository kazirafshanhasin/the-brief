import type { NextConfig } from "next";

// A GitHub Pages project site lives under /<repository>. The publish workflow sets this.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  // The shared package ships TypeScript source.
  transpilePackages: ["@brief/core"],
  poweredByHeader: false,
};

export default nextConfig;
