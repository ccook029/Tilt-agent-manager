import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { CommandPalette, CommandButton } from "@/components/command-palette";
import { Confetti } from "@/components/confetti";

export const metadata: Metadata = {
  title: "Tilt Corporate Headquarters",
  description: "AI-powered corporate headquarters for Tilt Hockey Inc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-gray-100 min-h-screen carbon-texture">
        {/* Animated aurora backdrop */}
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="aurora absolute inset-[-12%]" />
        </div>
        <ToastProvider>
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
              <span className="text-base text-gray-500 border-l border-gray-700 pl-5 group-hover:text-[#e4002b] transition-colors">
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
              <span className="text-xs text-gray-700">|</span>
              <span className="text-sm text-gray-600">Tilt Hockey Inc.</span>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8 relative z-10">
          {children}
        </main>
        <CommandPalette />
        </ToastProvider>
      </body>
    </html>
  );
}
