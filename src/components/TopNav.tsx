"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ReactiveUserButton } from "@/components/ReactiveUserButton";
import {
  Bookmark,
  CalendarCheck,
  LayoutGrid,
  Menu,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

import { NotificationBell } from "@/components/NotificationBell";
import { StreakBadge } from "@/components/Header/StreakBadge";
import { OfflineSyncProgressBar } from "@/components/OfflineSyncProgressBar";
import { NetworkStatusPill } from "@/components/NetworkStatusPill";
import { QuickSearchTrigger } from "@/components/ui/QuickSearchTrigger";

interface TopNavProps {
  hideAuth?: boolean;
}

const APP_LINKS = [
  { href: "/ai", label: "Discover", icon: Search },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/collections", label: "Collections", icon: LayoutGrid },
  { href: "/dashboard", label: "Bookings", icon: CalendarCheck },
  { href: "/social", label: "Community", icon: Users },
] as const;

/** Whether the signed-in user can see admin tools (checked server-side). */
function useIsAdmin(isSignedIn: boolean | undefined): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch("/api/user/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setIsAdmin(Boolean(data?.isAdmin));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  return isAdmin;
}

export function TopNav({ hideAuth = false }: TopNavProps) {
  const { isSignedIn } = useUser();
  const isAdmin = useIsAdmin(isSignedIn);
  const pathname = usePathname() ?? "";
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const navLinkClass = (href: string) =>
    [
      "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap",
      isActive(href)
        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
        : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-white/70 dark:hover:text-white dark:hover:bg-white/5",
    ].join(" ");

  // Close the mobile menu on navigation.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    const handleResize = () => {
      if (window.innerWidth >= 1024) setIsMenuOpen(false);
    };

    if (isMenuOpen) {
      document.addEventListener("keydown", handleEscape);
      window.addEventListener("resize", handleResize);
    }

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
    };
  }, [isMenuOpen]);

  const signedInLinks = [
    ...APP_LINKS,
    ...(isAdmin
      ? [{ href: "/admin/performance", label: "Admin", icon: Shield }]
      : []),
  ];

  return (
    <nav className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-white/5 backdrop-blur-xl bg-white/70 dark:bg-black/40 transition-colors">
      <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <Image
            src="/icons/icon-512.png"
            alt="WorkSphere logo"
            width={32}
            height={32}
            className="w-8 h-8 rounded-xl shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-shadow"
          />
          <span className="text-lg font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            WorkSphere
          </span>
        </Link>

        {!hideAuth && isSignedIn && (
          <div className="hidden lg:flex items-center gap-1 min-w-0">
            {signedInLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={navLinkClass(href)}
                aria-current={isActive(href) ? "page" : undefined}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <QuickSearchTrigger />
          <NetworkStatusPill />
          <ThemeToggle />

          {!hideAuth && (
            <>
              {!isSignedIn ? (
                <div className="hidden sm:flex items-center gap-2">
                  <Link
                    href="/sign-in"
                    className="px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    className="px-4 py-2 text-sm rounded-xl accent-bg text-white font-semibold hover:opacity-90"
                  >
                    Get started
                  </Link>
                </div>
              ) : (
                <>
                  <StreakBadge />
                  <NotificationBell />
                  <Link
                    href="/settings"
                    aria-label="Settings"
                    className={`hidden lg:flex p-2 rounded-lg ${
                      isActive("/settings")
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-zinc-500 hover:text-zinc-900 dark:text-white/60 dark:hover:text-white"
                    }`}
                  >
                    <Settings className="w-5 h-5" />
                  </Link>
                  <div className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden shrink-0">
                    <ReactiveUserButton
                      userProfileMode="navigation"
                      userProfileUrl="/user-profile"
                    />
                  </div>
                </>
              )}

              <button
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`${isSignedIn ? "lg:hidden" : "sm:hidden"} p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                aria-label="Toggle navigation menu"
                aria-expanded={isMenuOpen}
              >
                {isMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {isMenuOpen && (
        <>
          <div
            className="fixed inset-0 top-16 bg-black/60 backdrop-blur-sm lg:hidden z-40"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="lg:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black absolute top-full left-0 w-full z-50 shadow-xl">
            <div className="flex flex-col p-3 gap-1">
              {!isSignedIn ? (
                <>
                  <Link href="/sign-in" className={navLinkClass("/sign-in")}>
                    Sign in
                  </Link>
                  <Link href="/sign-up" className={navLinkClass("/sign-up")}>
                    Get started
                  </Link>
                </>
              ) : (
                <>
                  {signedInLinks.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={navLinkClass(href)}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </Link>
                  ))}
                  <Link href="/settings" className={navLinkClass("/settings")}>
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
      <OfflineSyncProgressBar />
    </nav>
  );
}
