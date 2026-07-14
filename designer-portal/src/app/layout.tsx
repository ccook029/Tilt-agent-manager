import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const barlowCondensed = localFont({
  src: [
    { path: "../../fonts/BarlowCondensed-Regular.ttf", weight: "400" },
    { path: "../../fonts/BarlowCondensed-Medium.ttf", weight: "500" },
    { path: "../../fonts/BarlowCondensed-SemiBold.ttf", weight: "600" },
    { path: "../../fonts/BarlowCondensed-Bold.ttf", weight: "700" },
    { path: "../../fonts/BarlowCondensed-ExtraBold.ttf", weight: "800" },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tilt Design Portal",
  description: "AI design studio for the Tilt team — chat, upload, and generate.",
  icons: { icon: "/brand/t-shield.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={barlowCondensed.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
