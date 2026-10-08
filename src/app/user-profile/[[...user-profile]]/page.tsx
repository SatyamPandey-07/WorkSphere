"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Heart,
  Shield,
  Settings,
  Sparkles,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { UserProfile } from "@clerk/nextjs";
import { CustomAvatarUpload } from "@/components/CustomAvatarUpload";
import { PasskeyManager } from "@/components/auth/PasskeyManager";
import { AccentPicker } from "@/components/AccentPicker";
import { VisitedVenuesCard } from "@/components/profile/VisitedVenuesCard";

export type ProfileTab = "bookings" | "favorites" | "security" | "settings";

export const VALID_PROFILE_TABS: readonly ProfileTab[] = [
  "bookings",
  "favorites",
  "security",
  "settings",
] as const;

export const PROFILE_TAB_CONFIG = [
  {
    id: "bookings" as ProfileTab,
    label: "Bookings",
    icon: Calendar,
    description: "Past & upcoming visits",
  },
  {
    id: "favorites" as ProfileTab,
    label: "Favorites",
    icon: Heart,
    description: "Saved workspace spots",
  },
  {
    id: "security" as ProfileTab,
    label: "Security",
    icon: Shield,
    description: "Passkeys & 2FA protection",
  },
  {
    id: "settings" as ProfileTab,
    label: "Settings",
    icon: Settings,
    description: "Account & appearance",
  },
];

export function UserProfileContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read initial active tab from URL query params (e.g. ?tab=security)
  const rawTab = searchParams.get("tab")?.toLowerCase();
  const activeTab: ProfileTab =
    rawTab === "favorites" ||
    rawTab === "security" ||
    rawTab === "settings" ||
    rawTab === "bookings"
      ? rawTab
      : "bookings";

  // Synchronize tab state with URL query parameters (?tab=...)
  // router.push ensures browser back and forward buttons navigate between visited tabs
  const handleTabChange = useCallback(
    (tabId: ProfileTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tabId);
      const queryString = params.toString();
      const url = queryString ? `${pathname}?${queryString}` : pathname;

      if (tabId === activeTab) {
        router.replace(url, { scroll: false });
      } else {
        router.push(url, { scroll: false });
      }
    },
    [pathname, searchParams, router, activeTab],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" data-testid="user-profile-page">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Navigation Breadcrumb */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
          <div className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
            /user-profile?tab={activeTab}
          </div>
        </div>

        {/* Profile Header Banner */}
        <div className="mb-8 p-6 rounded-3xl bg-gradient-to-r from-zinc-100 via-white to-zinc-100 dark:from-zinc-900 dark:via-zinc-900/80 dark:to-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              User Profile & Workspace Center
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Manage your venue reservations, saved favorites, passkey credentials, and account settings.
            </p>
          </div>
        </div>

        {/* Profile Tabs Navigation Bar */}
        <div className="mb-8 border-b border-zinc-200 dark:border-zinc-800" role="tablist" aria-label="Profile Sections">
          <nav className="flex space-x-2 sm:space-x-8 overflow-x-auto pb-px" aria-label="Tabs">
            {PROFILE_TAB_CONFIG.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  data-testid={`tab-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                  className={`group inline-flex items-center gap-2 py-4 px-3 border-b-2 font-medium text-sm transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? "border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400 font-semibold"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-700"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                    }`}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content Panels */}
        <div className="max-w-[880px] mx-auto w-full">
          {/* TAB: Bookings */}
          {activeTab === "bookings" && (
            <div
              role="tabpanel"
              id="tabpanel-bookings"
              aria-labelledby="tab-bookings"
              data-testid="tabpanel-bookings"
              className="space-y-6 animate-fade-in"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Venue Visits & Bookings</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Track workspaces, desks, and cafes you have checked into.
                  </p>
                </div>
                <Link
                  href="/venues"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Explore Venues
                </Link>
              </div>

              <VisitedVenuesCard />
            </div>
          )}

          {/* TAB: Favorites */}
          {activeTab === "favorites" && (
            <div
              role="tabpanel"
              id="tabpanel-favorites"
              aria-labelledby="tab-favorites"
              data-testid="tabpanel-favorites"
              className="space-y-6 animate-fade-in"
            >
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Saved Favorites & Collections</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Quickly access your pinned cafes, meeting spaces, and coworking spots.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center space-y-4 shadow-sm">
                <div className="mx-auto w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-500">
                  <Heart className="w-6 h-6 fill-current" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-zinc-900 dark:text-white text-base">Your Favorite Workspaces</h3>
                  <p className="text-sm text-zinc-500 max-w-md mx-auto">
                    Save venues while exploring to build your personalized remote work directory.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <Link
                    href="/favorites"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    View All Favorites
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    href="/venues"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Browse Directory
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Security */}
          {activeTab === "security" && (
            <div
              role="tabpanel"
              id="tabpanel-security"
              aria-labelledby="tab-security"
              data-testid="tabpanel-security"
              className="space-y-6 animate-fade-in"
            >
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Biometric Passkeys & Security</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Manage WebAuthn passkeys, hardware security keys, and account protection.
                </p>
              </div>

              <PasskeyManager />
            </div>
          )}

          {/* TAB: Settings */}
          {activeTab === "settings" && (
            <div
              role="tabpanel"
              id="tabpanel-settings"
              aria-labelledby="tab-settings"
              data-testid="tabpanel-settings"
              className="space-y-8 animate-fade-in"
            >
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Account Preferences & Appearance</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Update your display avatar, accent themes, and personal information.
                </p>
              </div>

              <CustomAvatarUpload />

              <div className="glass-card rounded-2xl p-6 border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                <AccentPicker />
              </div>

              <div className="flex justify-center pt-4">
                <UserProfile path="/user-profile" routing="path" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
          <div className="animate-pulse text-zinc-400 text-sm">Loading profile...</div>
        </div>
      }
    >
      <UserProfileContent />
    </Suspense>
  );
}
