import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agent Space — Mission Control for Your AI Agents",
  description:
    "Observe, debug, and manage every AI agent across your tools. Real-time dashboards, traces, and alerts — all in one place.",
  openGraph: {
    title: "Agent Space — Mission Control for Your AI Agents",
    description:
      "Observe, debug, and manage every AI agent across your tools. Real-time dashboards, traces, and alerts.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#0a0a0a] antialiased`}>
        {children}
      </body>
    </html>
  );
}
