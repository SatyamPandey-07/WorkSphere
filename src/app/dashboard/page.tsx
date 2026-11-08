"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { BarChart3, Search, Settings, Webhook } from "lucide-react";
import { BookingList } from "@/components/bookings/BookingList";
import { StreakCard } from "@/components/dashboard/StreakCard";
import { StudentVerificationBadge } from "@/components/student/StudentVerificationBadge";
import { MonthlyBudgetTracker } from "@/components/billing/MonthlyBudgetTracker";
import { CheckInHistory } from "./CheckInHistory";
import { WorkStyleProfile } from "./WorkStyleProfile";

export default function DashboardPage() {
  const { user } = useUser();
  const [counts, setCounts] = useState({ upcoming: 0, total: 0 });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-24 space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {user?.firstName ? `Hi, ${user.firstName}` : "Your workspace"}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            {counts.upcoming > 0
              ? `You have ${counts.upcoming} upcoming booking${counts.upcoming === 1 ? "" : "s"}.`
              : "Bookings, check-ins and streaks in one place."}
          </p>
          <div className="mt-2">
            <StudentVerificationBadge />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/ai"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl accent-bg text-white text-sm font-semibold hover:opacity-90"
          >
            <Search className="w-4 h-4" />
            Find a workspace
          </Link>
          <Link
            href="/analytics"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <BarChart3 className="w-4 h-4" />
            Insights
          </Link>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
        </div>
      </header>

      <MonthlyBudgetTracker />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section
          className="lg:col-span-2 space-y-3"
          aria-labelledby="bookings-heading"
        >
          <div className="flex items-center justify-between">
            <h2 id="bookings-heading" className="text-lg font-semibold">
              Bookings
            </h2>
            {counts.total > 0 && (
              <span className="text-xs text-zinc-500">
                Select bookings to export them for expenses
              </span>
            )}
          </div>
          <BookingList onCountsChange={setCounts} />
        </section>

        <aside className="space-y-6">
          <WorkStyleProfile />
          <StreakCard />
          <CheckInHistory />
          <Link
            href="/dashboard/webhooks"
            className="flex items-center gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
          >
            <Webhook className="w-5 h-5 text-purple-600" />
            <div>
              <p className="text-sm font-semibold">
                Integrations &amp; webhooks
              </p>
              <p className="text-xs text-zinc-500">
                Send bookings and check-ins to Slack, Discord, Zapier…
              </p>
            </div>
          </Link>
        </aside>
      </div>
    </div>
  );
}
