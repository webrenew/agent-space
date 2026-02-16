import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import {
  SITE_DESCRIPTION,
  SITE_INSTALLER_URL,
  SITE_NAME,
  SITE_OG_IMAGE,
  SITE_REPO_URL,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}${SITE_OG_IMAGE}`,
    sameAs: [SITE_REPO_URL],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS (Apple Silicon)",
    description: SITE_DESCRIPTION,
    downloadUrl: SITE_INSTALLER_URL,
    softwareHelp: `${SITE_REPO_URL}#readme`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  },
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  referrer: "origin-when-cross-origin",
  keywords: [
    "AI agent observability",
    "agent monitoring",
    "developer tools",
    "multi-agent workspace",
    "token tracking",
    "AI operations",
    "Claude Code",
    "Cursor",
    "desktop agent dashboard",
  ],
  authors: [{ name: "Webrenew" }],
  creator: "Webrenew",
  publisher: "Webrenew",
  category: "Developer Tools",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png" }],
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    images: [
      {
        url: SITE_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Agent Observer Open Graph image",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0e0d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className={`${jetbrainsMono.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}
