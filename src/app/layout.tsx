import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tilt Agent Orchestrator",
  description: "AI agent management dashboard for Tilt Sports Inc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/images/tilt-logo.png"
                alt="Tilt"
                width={80}
                height={24}
                className="invert brightness-200"
                priority
              />
              <span className="text-sm text-gray-400 border-l border-gray-700 pl-3">
                Agent Orchestrator
              </span>
            </Link>
            <span className="text-xs text-gray-500">Tilt Sports Inc.</span>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
