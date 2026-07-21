import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { cookies } from "next/headers";

import "./globals.css";

import I18nProvider from "../components/I18nProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { SoundProvider } from "../components/SoundProvider";
import { ScrollProgress } from "../components/ui/ScrollProgress";
import { CookieBanner } from "../components/CookieBanner";
import { SyncManager } from "../hooks/usePWA";
import { ToastProvider } from "../components/ui/Toast";
import { PWAUpdateListener } from "../components/PWAUpdateListener";

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("worksphere-theme");

    var theme = stored === "light" || stored === "dark" ||  stored === "cyberpunk"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
   root.classList.remove("dark", "cyberpunk");

if (theme === "dark") {
  root.classList.add("dark");
} else if (theme === "cyberpunk") {
  root.classList.add("cyberpunk");
}

root.style.colorScheme = theme === "light" ? "light" : "dark";
  } catch (e) {}

    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    if (document.cookie.indexOf("worksphere-theme=") === -1) {
      document.cookie =
        "worksphere-theme=" +
        theme +
        "; path=/; max-age=31536000; SameSite=Lax";
    }
  } catch {}

  try {
    var accentStored = localStorage.getItem("worksphere-accent");
    var accentColors = {
      blue: "#3b82f6",
      purple: "#a855f7",
      emerald: "#10b981",
      amber: "#f59e0b"
    };
    var accent = accentColors[accentStored] || accentColors.blue;
    document.documentElement.style.setProperty("--primary-accent", accent);
  } catch {}

  try {
    window.addEventListener("error", function (event) {
      if (
        event.message &&
        (event.message.indexOf("ResizeObserver") >= 0 ||
          event.message.indexOf("Resize observer") >= 0)
      ) {
        event.stopImmediatePropagation();
      }
    });
  } catch {}

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
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const cookieStore = await cookies();
  const storedTheme = cookieStore.get("worksphere-theme")?.value;
  const theme: "light" | "dark" =
    storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light";

  const storedAccent = cookieStore.get("worksphere-accent")?.value;
  const accent: "blue" | "purple" | "emerald" | "amber" =
    storedAccent === "blue" ||
    storedAccent === "purple" ||
    storedAccent === "emerald" ||
    storedAccent === "amber"
      ? storedAccent
      : "blue";

  const appContent = (
    <ThemeProvider initialTheme={theme} initialAccent={accent}>
      <SoundProvider>
        <ToastProvider>
          <PWAUpdateListener />
          <I18nProvider>{children}</I18nProvider>
        </ToastProvider>
      </SoundProvider>
    </ThemeProvider>
  );

  const bodyContent = (
    <ClerkProvider
      afterSignOutUrl="/"
      publishableKey={publishableKey}
      appearance={{
        elements: {
          formButtonPrimary: "accent-bg hover:opacity-90",
          card: "shadow-xl",
        },
      }}
    >
      {appContent}
    </ClerkProvider>
  );

  return (
    <html
      lang="en"
      className={theme === "dark" ? "dark" : ""}
      suppressHydrationWarning
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ScrollProgress />
        <SyncManager />
        {bodyContent}
        <CookieBanner />
      </body>
    </html>
  );
}
