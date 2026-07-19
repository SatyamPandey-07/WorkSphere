"use client";

import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import { Coffee, LayoutGrid, MapPin } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface TopNavProps {
  hideAuth?: boolean;
}

export function TopNav({ hideAuth = false }: TopNavProps) {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-200/80 dark:border-white/5 backdrop-blur-xl bg-white/70 dark:bg-black/40 transition-colors">
      <div className="container mx-auto px-6 sm:px-10 h-[72px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-shadow">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            WorkSphere
          </span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center justify-center shrink-0">
            <ThemeToggle />
          </div>

          {!hideAuth && isLoaded && (
            <>
              <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700 hidden sm:block" />
              {!isSignedIn ? (
                <>
                  <Link href="/sign-in">
                    <button className="px-3 sm:px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium transition-colors whitespace-nowrap">
                      Sign In
                    </button>
                  </Link>
                  <Link href="/sign-up">
                    <button className="px-4 sm:px-5 py-2 text-sm rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:scale-105 whitespace-nowrap">
                      Get Started
                    </button>
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/ai"
                    className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium transition-colors whitespace-nowrap"
                  >
                    <Coffee className="w-4 h-4" />
                    Dashboard
                  </Link>
                  <Link
                    href="/collections"
                    className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium transition-colors whitespace-nowrap"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Collections
                  </Link>
                  <div className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden shrink-0 ml-1">
                    <UserButton
                      userProfileMode="navigation"
                      userProfileUrl="/user-profile"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
