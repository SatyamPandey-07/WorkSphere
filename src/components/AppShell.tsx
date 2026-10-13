import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";
import { CosmosBackground } from "@/components/CosmosBackground";

/**
 * Shared chrome for signed-in app pages: global navigation above the page.
 * Pages keep control of their own content width and spacing.
 */
export function AppShell({
  children,
  showCosmosBackground = true,
}: {
  children: ReactNode;
  showCosmosBackground?: boolean;
}) {
  return (
    <div className="relative isolate min-h-screen flex flex-col bg-zinc-50 dark:bg-transparent text-zinc-900 dark:text-zinc-100 transition-colors">
      <CosmosBackground enabled={showCosmosBackground} />
      <TopNav />
      <main id="main-content" className="relative z-10 flex-1">
        {children}
      </main>
    </div>
  );
}
