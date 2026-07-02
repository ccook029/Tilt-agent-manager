import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IMAP/mail-parsing libs use Node APIs that must not be bundled.
  serverExternalPackages: ["imapflow", "mailparser"],
};

export default nextConfig;
