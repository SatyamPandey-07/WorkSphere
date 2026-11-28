import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { WhatsNewDialog } from "@/components/releases/WhatsNewDialog";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {children}
      <WhatsNewDialog />
    </AppShell>
  );
}
