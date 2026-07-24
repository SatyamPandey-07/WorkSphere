"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ReactiveUserButton } from "@/components/ReactiveUserButton";
import { Coffee, LayoutGrid, Menu, Shield, X } from "lucide-react";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";

interface TopNavProps {
  hideAuth?: boolean;
}

export function TopNav({ hideAuth = false }: TopNavProps) {
  const { isSignedIn } = useUser();
  console.log({
    hideAuth,
    isSignedIn,
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-200/80 dark:border-white/5 backdrop-blur-xl bg-white/70 dark:bg-black/40 transition-colors">
      <div className="container mx-auto px-6 sm:px-10 h-[72px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image
            src="/icons/icon-512.png"
            alt="WorkSphere logo"
            width={36}
            height={36}
            className="w-9 h-9 rounded-xl shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-shadow"
          />{" "}
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            WorkSphere
          </span>
        </Link>

        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center justify-center shrink-0">
            <ThemeToggle />
          </div>

          {!hideAuth && (
            <>
              <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700 hidden md:block" />

              {!isSignedIn ? (
                <>
                  {/* Desktop */}
                  <div className="hidden md:flex items-center gap-3">
                    <Link href="/sign-in">
                      <button className="px-3 sm:px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium">
                        Sign In
                      </button>
                    </Link>

                    <Link href="/sign-up">
                      <button className="px-4 sm:px-5 py-2 text-sm rounded-xl accent-bg text-white font-semibold">
                        Get Started
                      </button>
                    </Link>
                  </div>

                  {/* Mobile */}
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="md:hidden p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {isMenuOpen ? (
                      <X className="w-5 h-5" />
                    ) : (
                      <Menu className="w-5 h-5" />
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* Mobile Menu Button */}
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="md:hidden p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    aria-label="Toggle navigation menu"
                  >
                    {isMenuOpen ? (
                      <X className="w-5 h-5" />
                    ) : (
                      <Menu className="w-5 h-5" />
                    )}
                  </button>

                  {/* Desktop Links */}
                  <Link
                    href="/ai"
                    className="hidden md:flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium transition-colors whitespace-nowrap"
                  >
                    <Coffee className="w-4 h-4" />
                    Dashboard
                  </Link>

                  <Link
                    href="/collections"
                    className="hidden md:flex items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white font-medium transition-colors whitespace-nowrap"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Collections
                  </Link>
                  <Link
                    href="/admin/performance"
                    className="hidden md:flex items-center gap-2 px-4 py-2 text-sm text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 font-medium transition-colors whitespace-nowrap"
                  >
                    <Shield className="w-4 h-4" />
                    Admin
                  </Link>
                  <NotificationBell />
                  <div className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden shrink-0 ml-1">
                    <ReactiveUserButton
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

      {isMenuOpen && (
        <>
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm md:hidden z-40"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Mobile Menu Drawer */}
          <div className="md:hidden border-t bg-white dark:bg-black relative z-50">
            <div className="flex flex-col p-4 gap-3">
              {!isSignedIn ? (
                <>
                  <Link href="/sign-in" onClick={() => setIsMenuOpen(false)}>
                    Sign In
                  </Link>

                  <Link href="/sign-up" onClick={() => setIsMenuOpen(false)}>
                    Get Started
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/ai" onClick={() => setIsMenuOpen(false)}>
                    Dashboard
                  </Link>

                  <Link
                    href="/collections"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Collections
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
