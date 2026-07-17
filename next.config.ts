import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // sharp ใช้ native binary — กัน bundling serverless พังบน Vercel
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
