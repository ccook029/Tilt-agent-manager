import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { CommandPalette, CommandButton } from "@/components/command-palette";
import { Confetti } from "@/components/confetti";
import CursorSpotlight from "@/components/cursor-spotlight";
import { RunPipelineProvider } from "@/components/run-pipeline";
import IntroOverlay from "@/components/intro-overlay";
import StudioMenu from "@/components/studio-menu";
import SignOut from "@/components/sign-out";

const SITE_URL = "https://tilt-agent-manager-i3tk.vercel.app";
const OG_DESCRIPTION =
  "AI-powered corporate headquarters for Tilt Hockey — autonomous agents running analytics, competitive intel, inventory, and product design.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Tilt Corporate Headquarters",
    template: "%s · Tilt HQ",
  },
  description: OG_DESCRIPTION,
  applicationName: "Tilt HQ",
  icons: {
    icon: "/images/tilt-shield.png",
    apple: "/images/tilt-shield.png",
  },
  openGraph: {
    title: "Tilt Corporate Headquarters",
    description: OG_DESCRIPTION,
    url: SITE_URL,
    siteName: "Tilt HQ",
    type: "website",
    images: [
      { url: "/images/tilt-shield.png", width: 300, height: 360, alt: "Tilt Hockey" },
    ],
  },
  twitter: {
    card: "summary",
    title: "Tilt Corporate Headquarters",
    description: OG_DESCRIPTION,
    images: ["/images/tilt-shield.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0a0a] text-gray-100 min-h-screen carbon-texture">
        {/* Animated aurora backdrop */}
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="aurora absolute inset-[-12%]" />
        </div>
        {/* Film grain + cursor spotlight atmosphere */}
        <div className="grain pointer-events-none fixed inset-0 z-[45]" />
        <CursorSpotlight />
        <IntroOverlay />
        <ToastProvider>
        <RunPipelineProvider>
        <header className="border-b border-gray-800/60 px-6 py-6 bg-[#0a0a0a]/90 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-5 group">
              <Image
                src="/images/tilt-logo.png"
                alt="Tilt"
                width={320}
                height={96}
                className="invert brightness-200"
                priority
              />
              <span className="text-base text-gray-500 border-l border-gray-700 pl-5 group-hover:text-[#00d6ff] transition-colors">
                Corporate HQ
              </span>
            </Link>
            <div className="flex items-center gap-4">
              <CommandButton />
              <Link
                href="/dashboard"
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Operations
              </Link>
              <StudioMenu />
              <Link
                href="/inventory"
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Inventory
              </Link>
              <Link
                href="/files"
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Files
              </Link>
              <span className="text-xs text-gray-700">|</span>
              <SignOut />
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8 relative z-10">
          {children}
        </main>
        <CommandPalette />
        <Confetti />
        </RunPipelineProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
