import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IMAP/mail-parsing libs use Node APIs that must not be bundled.
  serverExternalPackages: ["imapflow", "mailparser"],
  // Social Studio (native module): ship the generated SQL migrations with the
  // /api/social/admin/migrate function so the web "Initialize database"
  // button can apply them in serverless.
  outputFileTracingIncludes: {
    "/api/social/admin/migrate": ["./drizzle/**/*"],
  },
  images: {
    // Social Studio assets are mirrored to Vercel Blob; allow remote loading
    // from the Blob CDN hosts.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "*.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
