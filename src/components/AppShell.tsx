import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";

/**
 * Shared chrome for signed-in app pages: global navigation above the page.
 * Pages keep control of their own content width and spacing.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-[#050510] text-zinc-900 dark:text-zinc-100 transition-colors">
      <TopNav />
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
