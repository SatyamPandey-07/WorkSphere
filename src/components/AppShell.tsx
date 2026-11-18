import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TopNav } from "@/components/TopNav";
import { CosmosBackground } from "@/components/CosmosBackground";

/**
 * Shared chrome for signed-in app pages: global navigation above the page.
 * Pages keep control of their own content width and spacing.
 */
export interface AppShellProps {
  children: ReactNode;
  showCosmosBackground?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function AppShell({
  children,
  showCosmosBackground = true,
  className,
  "data-testid": dataTestId = "app-shell",
}: AppShellProps) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "relative isolate min-h-screen flex flex-col bg-zinc-50 dark:bg-transparent text-zinc-900 dark:text-zinc-100 transition-colors",
        className
      )}
    >
      <CosmosBackground enabled={showCosmosBackground} />
      <TopNav />
      <main id="main-content" className="relative z-10 flex-1">
        {children}
      </main>
    </div>
  );
}

export default AppShell;
