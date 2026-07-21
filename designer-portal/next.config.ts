import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the agent-manager repo; without an explicit root,
  // Turbopack walks up and picks the parent's lockfile.
  turbopack: { root: __dirname },
};

export default nextConfig;
