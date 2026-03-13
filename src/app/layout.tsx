import type { Metadata } from "next";
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
            <h1 className="text-xl font-bold tracking-tight">
              Tilt Agent Orchestrator
            </h1>
            <span className="text-xs text-gray-500">Tilt Sports Inc.</span>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
