"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Wifi,
  Zap,
  Volume2,
  Clock,
  Sparkles,
  Download,
  ArrowRight,
  Camera,
  Radio,
  Star,
  Users,
  Building2,
  ChevronRight,
  FileText,
  BarChart3,
  ArrowUp,
} from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import SiteFooter from "@/components/site-footer";
import { TopNav } from "@/components/TopNav";
import FAQAccordion from "@/components/ui/FAQAccordion";

export default function Home() {
  const [isVisible, setIsVisible] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  const { isSignedIn } = useUser();

  useEffect(() => {
    setIsVisible(true);
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050510] text-zinc-900 dark:text-white overflow-x-hidden transition-colors">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-blue-700/20 blur-[120px]"
          style={{
            transform: `translateX(-50%) translateY(${scrollY * 0.05}px)`,
          }}
        />
        <div
          className="absolute top-1/3 -left-40 w-[500px] h-[500px] rounded-full bg-purple-700/15 blur-[100px]"
          style={{ transform: `translateY(${scrollY * 0.08}px)` }}
        />
        <div
          className="absolute top-1/2 -right-40 w-[500px] h-[500px] rounded-full bg-cyan-700/10 blur-[100px]"
          style={{ transform: `translateY(${scrollY * 0.06}px)` }}
        />
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>
      <TopNav />

      {/* Hero */}
      <main className="container mx-auto px-4">
        <div
          className={`text-center max-w-5xl mx-auto pt-20 pb-16 transition-all duration-1000 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 text-sm text-zinc-700 dark:text-white/70 mb-8 backdrop-blur-sm shadow-sm dark:shadow-none">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
            </span>
            Cafés, coworking spaces &amp; libraries &nbsp;&bull;&nbsp; AI search
            &nbsp;&bull;&nbsp; Free to use
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-8xl font-bold mb-6 tracking-tight leading-[1.05]">
            Find Your
            <br />
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Perfect Spot
              </span>
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 300 12"
                fill="none"
              >
                <path
                  d="M2 8 Q75 2 150 8 Q225 14 298 8"
                  stroke="url(#u)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="u" x1="0" y1="0" x2="1" y2="0">
                    <stop stopColor="#60A5FA" />
                    <stop offset="0.5" stopColor="#A78BFA" />
                    <stop offset="1" stopColor="#22D3EE" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-600 dark:text-white/50 mb-10 max-w-2xl mx-auto leading-relaxed">
            Describe what you need — &ldquo;quiet café with fast Wi-Fi and
            outlets&rdquo; — and WorkSphere finds and ranks nearby places to
            work, rated by people who actually worked there. Reserve a spot in
            seconds.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {!isSignedIn ? (
              <>
                <Link
                  href="/sign-up"
                  className="group px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-base hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, #2563eb, #7c3aed)",
                  }}
                >
                  Start for Free
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <a
                  href="#features"
                  className="px-8 py-4 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 text-zinc-800 dark:text-white/80 font-semibold text-base hover:bg-zinc-50 hover:border-zinc-300 dark:hover:bg-white/10 dark:hover:border-white/20 transition-all backdrop-blur-sm shadow-sm dark:shadow-none"
                >
                  See Features
                </a>
              </>
            ) : (
              <Link
                href="/ai"
                className="group px-8 py-4 rounded-2xl accent-bg text-white font-semibold text-base hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                Open Dashboard
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            )}
          </div>

          <p className="mt-6 text-xs text-zinc-500 dark:text-white/30 md:hidden flex items-center justify-center gap-1.5">
            <Download className="w-3 h-3" />
            Install as an app for the best experience
          </p>
        </div>

        {/* Stats strip */}
        <div
          className={`grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-20 transition-all duration-1000 delay-100 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          {[
            {
              value: "Worldwide",
              label: "Live map coverage",
              icon: <Building2 className="w-4 h-4" />,
            },
            {
              value: "Plain English",
              label: "AI search",
              icon: <Sparkles className="w-4 h-4" />,
            },
            {
              value: "Wi-Fi · noise",
              label: "Community ratings",
              icon: <Star className="w-4 h-4" />,
            },
            {
              value: "Free",
              label: "Desk reservations",
              icon: <Radio className="w-4 h-4" />,
            },
          ].map((stat, i) => (
            <div
              key={i}
              className="p-5 rounded-2xl border border-zinc-200 dark:border-white/8 bg-white/80 dark:bg-white/4 backdrop-blur-sm text-center hover:border-zinc-300 hover:bg-white dark:hover:border-white/15 dark:hover:bg-white/6 transition-all shadow-sm dark:shadow-none"
            >
              <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-white/40 text-xs mb-2">
                {stat.icon}
                {stat.label}
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Hero Mockup */}
        <div
          className={`relative max-w-5xl mx-auto mb-24 transition-all duration-1000 delay-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-cyan-600/20 dark:from-blue-600/30 dark:via-purple-600/30 dark:to-cyan-600/30 blur-xl" />
          <div className="relative rounded-2xl overflow-hidden border border-zinc-200 dark:border-white/10 shadow-2xl shadow-zinc-300/50 dark:shadow-black/50">
            <Image
              src="/images/hero-mockup.png"
              alt="WorkSphere App"
              width={1400}
              height={900}
              className="w-full h-auto"
              priority
            />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-zinc-50 dark:from-[#050510] to-transparent" />
          </div>
          {/* Floating chips */}
          <div className="absolute -left-6 top-1/4 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/95 dark:bg-black/80 border border-zinc-200 dark:border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-zinc-900 dark:text-white text-sm font-semibold">
                AI search
              </p>
              <p className="text-zinc-500 dark:text-white/40 text-xs">
                Ask in plain English
              </p>
            </div>
          </div>
          <div className="absolute -right-6 top-1/3 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/95 dark:bg-black/80 border border-zinc-200 dark:border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Radio className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-zinc-900 dark:text-white text-sm font-semibold">
                Live updates
              </p>
              <p className="text-zinc-500 dark:text-white/40 text-xs">
                Ratings &amp; availability
              </p>
            </div>
          </div>
          <div className="absolute -right-6 bottom-1/4 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/95 dark:bg-black/80 border border-zinc-200 dark:border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-zinc-900 dark:text-white text-sm font-semibold">
                Venue photos
              </p>
              <p className="text-zinc-500 dark:text-white/40 text-xs">
                See it before you go
              </p>
            </div>
          </div>
          <div className="absolute -left-6 bottom-1/4 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/95 dark:bg-black/80 border border-zinc-200 dark:border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center">
              <Star className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-zinc-900 dark:text-white text-sm font-semibold">
                Rating System
              </p>
              <p className="text-zinc-500 dark:text-white/40 text-xs">
                Community-driven
              </p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div
          id="features"
          className={`mb-24 transition-all duration-1000 delay-300 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          <div className="text-center mb-12">
            <span className="text-xs font-semibold tracking-widest accent-text uppercase">
              Everything you need
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mt-3 mb-4">
              Built for remote workers
            </h2>
            <p className="text-zinc-600 dark:text-white/40 max-w-xl mx-auto">
              Every feature designed to help you find and enjoy the best
              workspace for your day.
            </p>
          </div>
          <div
            data-testid="venue-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 max-w-5xl mx-auto"
          >
            <FeatureCard
              icon={<Sparkles className="w-5 h-5" />}
              title="Ask in plain English"
              description="Describe how you want to work today and get a ranked shortlist of nearby places, with the reasons each one fits."
              accent="indigo"
            />
            <FeatureCard
              icon={<Wifi className="w-5 h-5" />}
              title="Wi-Fi you can trust"
              description="Speeds and quality reported by people who worked there, so video calls and big uploads don't catch you out."
              accent="blue"
            />
            <FeatureCard
              icon={<Volume2 className="w-5 h-5" />}
              title="Noise levels"
              description="Filter for quiet zones when you need deep focus, or livelier spots for casual sessions."
              accent="green"
            />
            <FeatureCard
              icon={<Zap className="w-5 h-5" />}
              title="Power outlets"
              description="Know before you go whether there are outlets at every table or just a few by the wall."
              accent="yellow"
            />
            <FeatureCard
              icon={<Clock className="w-5 h-5" />}
              title="Busy times"
              description="See how crowded a place usually is and pick the best time to arrive."
              accent="purple"
            />
            <FeatureCard
              icon={<Star className="w-5 h-5" />}
              title="Community ratings"
              description="Rate Wi-Fi, outlets and noise after a session to help the next person find a great spot."
              accent="orange"
            />
            <FeatureCard
              icon={<BarChart3 className="w-5 h-5" />}
              title="Bookings in one place"
              description="Reserve a desk, invite teammates, add it to your calendar, and cancel in a tap if plans change."
              accent="teal"
            />
            <FeatureCard
              icon={<FileText className="w-5 h-5" />}
              title="Receipts & exports"
              description="Download a PDF receipt for any booking, or export your history as CSV or PDF for expenses."
              accent="violet"
            />
          </div>
        </div>

        {/* How it works */}
        <div
          className={`max-w-3xl mx-auto mb-24 transition-all duration-1000 delay-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          <div className="text-center mb-12">
            <span className="text-xs font-semibold tracking-widest text-purple-600 dark:text-purple-400 uppercase">
              Simple as it gets
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mt-3">
              How it works
            </h2>
          </div>
          <div className="space-y-4">
            {[
              {
                n: 1,
                title: "Tell the AI what you need",
                desc: 'Just type naturally: "Find a quiet cafe with good WiFi and outlets near me"',
              },
              {
                n: 2,
                title: "We rank real places for you",
                desc: "Community ratings are combined with live map data, and every place is scored on Wi-Fi, noise, outlets and distance.",
              },
              {
                n: 3,
                title: "Explore on the map",
                desc: "Compare options on an interactive map with photos, ratings, opening hours and directions.",
              },
              {
                n: 4,
                title: "Rate, book & download receipts",
                desc: "Share your experience, track bookings in your dashboard, and download PDF receipts instantly.",
              },
            ].map((step) => (
              <Step
                key={step.n}
                number={step.n}
                title={step.title}
                description={step.desc}
              />
            ))}
          </div>
        </div>

        {/* FAQ Section */}
        <div
          className={`transition-all duration-1000 delay-600 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          <FAQAccordion />
        </div>

        {/* CTA */}
        <div
          className={`relative rounded-3xl overflow-hidden mb-24 mx-2 transition-all duration-1000 delay-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-700 to-cyan-700" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
          <div className="relative p-12 md:p-20 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-sm mb-6 backdrop-blur-sm border border-white/20">
              <Users className="w-4 h-4" />
              Join remote workers worldwide
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
              Ready to find your
              <br />
              perfect workspace?
            </h2>
            <p className="text-blue-100/70 text-lg mb-10 max-w-lg mx-auto">
              AI-powered search, community ratings and free desk reservations.
            </p>
            <Link
              href={isSignedIn ? "/ai" : "/sign-up"}
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white accent-text font-bold text-base hover:bg-zinc-100 transition-all shadow-2xl hover:shadow-white/20 hover:scale-105"
            >
              Get Started Free
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <SiteFooter />

      {/* Scroll to Top Button */}
      {scrollY > 300 && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 left-6 z-50 p-3 rounded-xl accent-bg text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 hover:scale-110 active:scale-95 transition-all duration-300 border border-white/10 cursor-pointer group"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}

// Gradient color map for each accent — used for the animated border
const ACCENT_GRADIENTS: Record<string, string> = {
  blue: "135deg, #3b82f6, #8b5cf6, #06b6d4",
  green: "135deg, #22c55e, #10b981, #3b82f6",
  yellow: "135deg, #eab308, #f97316, #ef4444",
  purple: "135deg, #a855f7, #6366f1, #ec4899",
  pink: "135deg, #ec4899, #f43f5e, #a855f7",
  cyan: "135deg, #06b6d4, #3b82f6, #8b5cf6",
  red: "135deg, #ef4444, #f97316, #eab308",
  indigo: "135deg, #6366f1, #8b5cf6, #06b6d4",
  orange: "135deg, #f97316, #eab308, #ef4444",
  teal: "135deg, #14b8a6, #22c55e, #06b6d4",
  violet: "135deg, #7c3aed, #a855f7, #ec4899",
};

function FeatureCard({
  icon,
  title,
  description,
  accent,
  isNew,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: string;
  isNew?: boolean;
}) {
  const accents: Record<string, { glow: string; text: string; bg: string }> = {
    blue: {
      glow: "hover:shadow-blue-500/25",
      text: "accent-text",
      bg: "accent-bg-10",
    },
    green: {
      glow: "hover:shadow-green-500/25",
      text: "text-green-400",
      bg: "bg-green-500/10",
    },
    yellow: {
      glow: "hover:shadow-yellow-500/25",
      text: "text-yellow-400",
      bg: "bg-yellow-500/10",
    },
    purple: {
      glow: "hover:shadow-purple-500/25",
      text: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    pink: {
      glow: "hover:shadow-pink-500/25",
      text: "text-pink-400",
      bg: "bg-pink-500/10",
    },
    cyan: {
      glow: "hover:shadow-cyan-500/25",
      text: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
    red: {
      glow: "hover:shadow-red-500/25",
      text: "text-red-400",
      bg: "bg-red-500/10",
    },
    indigo: {
      glow: "hover:shadow-indigo-500/25",
      text: "text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    orange: {
      glow: "hover:shadow-orange-500/25",
      text: "text-orange-400",
      bg: "bg-orange-500/10",
    },
    teal: {
      glow: "hover:shadow-teal-500/25",
      text: "text-teal-400",
      bg: "bg-teal-500/10",
    },
    violet: {
      glow: "hover:shadow-violet-500/25",
      text: "text-violet-400",
      bg: "bg-violet-500/10",
    },
  };
  const a = accents[accent] ?? accents.blue;
  const gradient = ACCENT_GRADIENTS[accent] ?? ACCENT_GRADIENTS.blue;

  return (
    <div
      className={`
        relative group p-6 rounded-2xl
        bg-white/80 dark:bg-white/4
        hover:bg-white dark:hover:bg-white/6
        hover:shadow-xl ${a.glow}
        hover:-translate-y-1
        transition-all duration-300
        backdrop-blur-sm shadow-sm dark:shadow-none
        /* gradient border layer */
        before:absolute before:inset-0 before:rounded-2xl before:p-px
        before:opacity-0 hover:before:opacity-100
        before:transition-opacity before:duration-300
        before:-z-10
      `}
      style={
        {
          /* Simulate an animated gradient border using a CSS outline trick:
           We use a box-shadow inset + pseudo approach via the wrapper below */
          "--grad": `linear-gradient(${gradient})`,
        } as React.CSSProperties
      }
    >
      {/* Gradient border ring — rendered via an absolute overlay */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          padding: "1.5px",
          background: `linear-gradient(${gradient})`,
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />

      {isNew && (
        <span className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-blue-500 to-purple-500 text-white z-10">
          NEW
        </span>
      )}
      <div
        className={`inline-flex p-3 rounded-xl mb-5 ${a.bg} ${a.text} group-hover:scale-110 transition-transform duration-300`}
      >
        {icon}
      </div>
      <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-zinc-600 dark:text-white/40 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex gap-5 p-5 rounded-2xl border border-zinc-200 dark:border-white/5 bg-white/80 dark:bg-white/3 hover:bg-white dark:hover:bg-white/5 hover:border-zinc-300 dark:hover:border-white/10 transition-all backdrop-blur-sm shadow-sm dark:shadow-none">
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 text-white flex items-center justify-center text-sm font-bold shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
          {number}
        </div>
      </div>
      <div>
        <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-1.5">
          {title}
        </h3>
        <p className="text-sm text-zinc-600 dark:text-white/40 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
