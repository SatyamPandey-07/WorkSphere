"use client";

import React, { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, UserCircle, Webhook } from "lucide-react";
import { UserPreferenceToggle } from "@/components/UserPreferenceToggle";
import { AccentPicker } from "@/components/AccentPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PasskeyManager } from "@/components/auth/PasskeyManager";
import { TelegramStatusBanner } from "@/components/dashboard/TelegramStatusBanner";
import { WorkStyleProfile } from "@/app/dashboard/WorkStyleProfile";
import { NotificationSettings } from "@/app/dashboard/NotificationSettings";
import { MemoryManager } from "@/app/dashboard/MemoryManager";

const PERSONALIZATION_KEY = "ai_personalization_enabled";

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <div className="mb-4">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "preferences", label: "Preferences" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
  { id: "appearance", label: "Appearance" },
];

export default function SettingsPage() {
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PERSONALIZATION_KEY);
      if (stored !== null) setPersonalizationEnabled(stored === "true");
    } catch {
      // storage unavailable (private mode) — keep default
    }
  }, []);

  const handleToggle = (enabled: boolean) => {
    setPersonalizationEnabled(enabled);
    try {
      localStorage.setItem(PERSONALIZATION_KEY, String(enabled));
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Settings</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Manage your account, preferences and connected apps.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block px-3 py-2 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-12 min-w-0">
          <Section
            id="account"
            title="Account"
            description="Your name, email addresses, password and connected sign-in methods."
          >
            <Link
              href="/user-profile"
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              <span className="flex items-center gap-3">
                <UserCircle className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">Manage account</span>
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </Link>
          </Section>

          <Section
            id="preferences"
            title="Preferences"
            description="Tell WorkSphere how you like to work so results fit you better."
          >
            <WorkStyleProfile />
            <UserPreferenceToggle
              enabled={personalizationEnabled}
              onToggle={handleToggle}
            />
            <MemoryManager />
          </Section>

          <Section
            id="notifications"
            title="Notifications"
            description="Reminders before bookings and sessions, and quiet hours."
          >
            <NotificationSettings />
          </Section>

          <Section
            id="security"
            title="Security"
            description="Sign in faster and more securely with passkeys."
          >
            <PasskeyManager />
          </Section>

          <Section
            id="integrations"
            title="Integrations"
            description="Send bookings, check-ins and reviews to the tools you already use."
          >
            <TelegramStatusBanner />
            <Link
              href="/dashboard/webhooks"
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              <span className="flex items-center gap-3">
                <Webhook className="w-5 h-5 text-purple-600" />
                <span>
                  <span className="block text-sm font-medium">
                    Webhooks, Discord &amp; Telegram
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Signed HTTP callbacks for Zapier, Make, Slack or your own
                    app
                  </span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </Link>
          </Section>

          <Section
            id="appearance"
            title="Appearance"
            description="Theme and accent colour."
          >
            <div className="flex flex-wrap items-center gap-6 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Theme</span>
                <ThemeToggle />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Accent</span>
                <AccentPicker />
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
