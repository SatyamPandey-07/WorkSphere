import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import I18nProvider from "../components/I18nProvider";

import { headers } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WorkSphere - AI-Powered Remote Workspace Finder",
  description: "Discover cafes, coworking spaces, and libraries with great WiFi, power outlets, and the perfect atmosphere for your work style.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WorkSphere",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "WorkSphere",
    title: "WorkSphere - AI-Powered Remote Workspace Finder",
    description: "Find your perfect workspace with AI-powered recommendations",
  },
  twitter: {
    card: "summary_large_image",
    title: "WorkSphere",
    description: "AI-Powered Remote Workspace Finder",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const isAnalyticsPage = pathname.startsWith("/analytics");

  const isDummyKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk";

  const content = (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <I18nProvider>
          {children}
        </I18nProvider>
      </body>
    </html>
  );

  if (isDummyKey && isAnalyticsPage) {
    return content;
  }

  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "pk_test_ZW5hYmxlZC1jYXQtNDguY2xlcmsuYWNjb3VudHMuZGV2JA"}
      appearance={{
        elements: {
          formButtonPrimary: "bg-blue-600 hover:bg-blue-700",
          card: "shadow-xl",
        },
      }}
    >
      {content}
    </ClerkProvider>
  );
}
