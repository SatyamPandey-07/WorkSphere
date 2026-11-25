import React from 'react';
import { SkipToContent } from '@/components/ui/SkipToContent';

export interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <SkipToContent targetId="main-content" />
        <main
          id="main-content"
          tabIndex={-1}
          data-testid="main-content"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
