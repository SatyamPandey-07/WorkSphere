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
import { ChatUnreadBadge } from "@/components/chat/ChatUnreadBadge";
import { useUnreadMessageTracking } from "@/lib/chat/unreadTracker";
import { OfflineSyncProgressBar } from "@/components/OfflineSyncProgressBar";
import { NetworkStatusPill } from "@/components/NetworkStatusPill";
import { OfflineSyncStatusBadge } from "@/components/sync/OfflineSyncStatusBadge";
import { OfflineConflictBadge } from "@/components/offline/OfflineConflictBadge";
import { StorageUsageWarningBadge } from "@/components/Header/StorageUsageWarningBadge";
import { OfflineDraftCountBadge } from "@/components/navigation/OfflineDraftCountBadge";
import { BatterySaverIndicator } from "@/components/navigation/BatterySaverIndicator";
import { QuickSearchTrigger } from "@/components/ui/QuickSearchTrigger";
import { LanternPowerRing } from "@/components/analytics/LanternPowerRing";

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

/**
 * Space reserved for the right-hand auth cluster, sized for its widest
 * signed-in state at each breakpoint (streak + bell + avatar + menu button
 * below `lg`, streak + bell + settings + avatar from `lg`). Because the cluster
 * is right-aligned, anything that appears inside it grows into this reserved
 * space instead of pushing neighbours around. It is a min-width so a wider
 * StreakBadge degrades to a small shift rather than an overlap; tune the two
 * values if your trace shows one.
 */
const AUTH_CLUSTER_WIDTH = "min-w-[184px] sm:min-w-[220px]";

/**
 * Pins Clerk's avatar to the same 36x36 box as the skeleton so the swap cannot
 * change size. If ReactiveUserButton accepts an `appearance` prop, prefer
 * `elements.userButtonAvatarBox: "!w-9 !h-9"` there and drop these selectors.
 */
const AVATAR_SIZE_OVERRIDES =
  "[&_.cl-avatarBox]:!h-9 [&_.cl-avatarBox]:!w-9 [&_.cl-userButtonAvatarBox]:!h-9 [&_.cl-userButtonAvatarBox]:!w-9";

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
  const { isLoaded, isSignedIn, user } = useUser();
  const isAdmin = useIsAdmin(isSignedIn);
  const pathname = usePathname() ?? "";
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isAiActive = pathname === "/ai" || pathname.startsWith("/ai/");
  const { unreadCount } = useUnreadMessageTracking({
    roomId: "default",
    currentUserId: user?.id || null,
    currentUserName: user?.firstName || null,
    isChatOpen: isAiActive,
  });

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

  /* Admin is deliberately the LAST entry: the desktop row is left-aligned, so
  when the async admin check resolves the link is appended at the end and no
  other link moves. */

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
            {signedInLinks.map(({ href, label, icon: Icon }) => {
              const isDiscoverLink = href === "/ai";
              const showBadge = isDiscoverLink && unreadCount > 0;
              const linkAriaLabel = showBadge
                ? `${label} (${unreadCount > 99 ? "99+" : unreadCount} unread chat messages)`
                : undefined;

              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative ${navLinkClass(href)}`}
                  aria-current={isActive(href) ? "page" : undefined}
                  aria-label={linkAriaLabel}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  {showBadge && (
                    <ChatUnreadBadge count={unreadCount} className="ml-1" />
                  )}
                </Link>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <QuickSearchTrigger />
          <NetworkStatusPill />
          <OfflineSyncStatusBadge />
          <OfflineConflictBadge />
          <OfflineDraftCountBadge />
          <BatterySaverIndicator />
          <StorageUsageWarningBadge />
          <LanternPowerRing size="sm" className="hidden sm:inline-flex" />
          <ThemeToggle />

          {!hideAuth && (
            <div
              className={`${AUTH_CLUSTER_WIDTH} shrink-0 flex items-center justify-end gap-2`}
            >
              {/* Auth controls. Only the active state is mounted, so nothing
                  invisible takes up space, receives focus or fires requests.
                  The container itself stays mounted so it can fade in. */}
              <div
                className={`flex items-center gap-2 transition-opacity duration-200 motion-reduce:transition-none ${
                  isLoaded ? "opacity-100" : "opacity-0"
                }`}
              >
                {isLoaded && !isSignedIn && (
                  <div className="hidden sm:flex items-center gap-2">
                    <Link
                      href="/sign-in"
                      className="px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium whitespace-nowrap"
                    >
                      Sign in
                    </Link>

                    <Link
                      href="/sign-up"
                      className="px-4 py-2 text-sm rounded-xl accent-bg text-white font-semibold hover:opacity-90 whitespace-nowrap"
                    >
                      Get started
                    </Link>
                  </div>
                )}

                {isLoaded && isSignedIn && (
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
                  </>
                )}
              </div>

              {/* Fixed 36x36 avatar slot. The skeleton and the Clerk button
                  share this exact box, so swapping them never changes layout. */}
              <div
                className={`relative w-9 h-9 shrink-0 ${AVATAR_SIZE_OVERRIDES}`}
              >
                {/* Loading skeleton. The pulse lives on an inner element and
                    only runs while loading: a running CSS animation would
                    otherwise override the fade-out opacity. */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${
                    isLoaded ? "opacity-0" : "opacity-100"
                  }`}
                >
                  <div
                    className={`w-full h-full rounded-full bg-zinc-200 dark:bg-zinc-700 ${
                      isLoaded ? "" : "animate-pulse motion-reduce:animate-none"
                    }`}
                  />
                </div>

                {/* User avatar */}
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 motion-reduce:transition-none ${
                    isLoaded && isSignedIn ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {isLoaded && isSignedIn && (
                    <ReactiveUserButton
                      userProfileMode="navigation"
                      userProfileUrl="/user-profile"
                    />
                  )}
                </div>
              </div>

              {/* Mobile menu */}
              <button
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className="lg:hidden p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Toggle navigation menu"
                aria-expanded={isMenuOpen}
              >
                {isMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile navigation menu */}
      {isMenuOpen && (
        <>
          <div
            className="fixed inset-0 top-16 bg-black/60 backdrop-blur-sm lg:hidden z-40"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />

          <div className="lg:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black absolute top-full left-0 w-full z-50 shadow-xl">
            <div className="flex flex-col p-3 gap-1">
              {!isLoaded ? null : !isSignedIn ? (
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
                  {signedInLinks.map(({ href, label, icon: Icon }) => {
                    const isDiscoverLink = href === "/ai";
                    const showBadge = isDiscoverLink && unreadCount > 0;
                    const linkAriaLabel = showBadge
                      ? `${label} (${unreadCount > 99 ? "99+" : unreadCount} unread chat messages)`
                      : undefined;

                    return (
                      <Link
                        key={href}
                        href={href}
                        className={`relative ${navLinkClass(href)}`}
                        aria-label={linkAriaLabel}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                        {showBadge && (
                          <ChatUnreadBadge
                            count={unreadCount}
                            className="ml-1"
                          />
                        )}
                      </Link>
                    );
                  })}
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
