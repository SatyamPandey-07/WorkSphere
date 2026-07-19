import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import I18nProvider from "../components/I18nProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { ScrollProgress } from "../components/ui/ScrollProgress";

import { headers, cookies } from "next/headers";

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("worksphere-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    // Keep cookie synchronized so server can pre-render correctly
    if (document.cookie.indexOf("worksphere-theme=") === -1) {
      document.cookie = "worksphere-theme=" + theme + "; path=/; max-age=31536000; SameSite=Lax";
    }
  } catch (e) {}

  try {
    window.addEventListener("error", function (e) {
      if (e.message && (e.message.indexOf("ResizeObserver") >= 0 || e.message.indexOf("Resize observer") >= 0)) {
        e.stopImmediatePropagation();
      }
    });
  } catch (e) {}
})();
`;

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
  description:
    "Discover cafes, coworking spaces, and libraries with great WiFi, power outlets, and the perfect atmosphere for your work style.",
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

  const isDummyKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ===
    "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk";

  const cookieStore = await cookies();
  const theme = (cookieStore.get("worksphere-theme")?.value as "light" | "dark") || "light";

  const innerContent = (
    <ThemeProvider initialTheme={theme}>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );

  const bodyContent =
    isDummyKey && isAnalyticsPage ? (
      innerContent
    ) : (
      <ClerkProvider
        publishableKey={
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          "pk_test_ZXhhbXBsZS5hY2NvdW50cy5kZXYk"
        }
        appearance={{
          elements: {
            formButtonPrimary: "bg-blue-600 hover:bg-blue-700",
            card: "shadow-xl",
          },
        }}
      >
        {innerContent}
      </ClerkProvider>
    );

  return (
    <html lang="en" className={theme === "dark" ? "dark" : ""} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Sets the theme class before first paint so the sun/moon icon
            never flashes the wrong state on load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ScrollProgress />
        {bodyContent}
      </body>
    </html>
  );
}
