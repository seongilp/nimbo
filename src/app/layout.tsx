import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pretendard (Korean UI font) is bundled and self-hosted — NOT loaded from a CDN.
// Nimbo runs on self-hosted servers that are often on isolated / air-gapped /
// VPN-only networks with no outbound internet; a render-blocking external
// stylesheet (jsdelivr) that can't be reached hangs the page to a blank white
// screen. next/font/local serves it from the app's own /_next/static with
// font-display: swap, so text renders immediately regardless of connectivity.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

export const metadata: Metadata = {
  title: "Nimbo — Your own cloud, self-hosted",
  description: "Manage your Linux server like a NAS — files, storage, ZFS, backups, containers & more.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} ${pretendard.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
