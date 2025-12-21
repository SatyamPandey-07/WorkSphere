"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Wifi, Zap, Volume2, Clock, Sparkles, Download, ArrowRight, Coffee } from "lucide-react";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function Home() {
  const [isVisible, setIsVisible] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    setIsVisible(true);
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/30 to-zinc-50 dark:from-black dark:via-blue-950/20 dark:to-zinc-950 overflow-x-hidden">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-3xl"
          style={{ transform: `translateY(${scrollY * 0.1}px)` }}
        />
        <div 
          className="absolute top-1/2 -right-32 w-80 h-80 bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-3xl"
          style={{ transform: `translateY(${scrollY * 0.15}px)` }}
        />
        <div 
          className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-cyan-400/15 dark:bg-cyan-600/10 rounded-full blur-3xl"
          style={{ transform: `translateY(${scrollY * 0.08}px)` }}
        />
      </div>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-black/80 border-b border-zinc-200/50 dark:border-zinc-800/50">
        <div className="container mx-auto px-4 py-4 md:py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
              <MapPin className="w-4 h-4 md:w-5 md:h-5 text-white" />
            </div>
            <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              WorkSphere
            </span>
          </Link>
          <div className="flex items-center gap-2 md:gap-4">
            <SignedOut>
              <Link href="/sign-in">
                <button className="px-3 md:px-4 py-2 text-sm md:text-base text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 font-medium transition-all hover:scale-105">
                  Sign In
                </button>
              </Link>
              <Link href="/sign-up">
                <button className="px-4 md:px-6 py-2 text-sm md:text-base rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:scale-105">
                  Sign Up
                </button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link
                href="/ai"
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 font-medium transition-all hover:scale-105"
              >
                <Coffee className="w-4 h-4" />
                Dashboard
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-12 md:py-20">
        <div className={`text-center max-w-4xl mx-auto mb-16 md:mb-24 transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <div className="mb-6 md:mb-8">
            <span className="inline-flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-full bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-700 dark:text-blue-300 text-xs md:text-sm font-medium shadow-sm border border-blue-200/50 dark:border-blue-700/30">
              <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4 animate-pulse" />
              AI-Powered Workspace Discovery
            </span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-zinc-900 dark:text-zinc-50 mb-6 md:mb-8 tracking-tight leading-tight">
            Find Your Perfect
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-500 bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
              Work Space
            </span>
          </h1>
          
          <p className="text-lg md:text-xl lg:text-2xl text-zinc-600 dark:text-zinc-400 mb-8 md:mb-10 max-w-2xl mx-auto px-4 leading-relaxed">
            Discover cafes, coworking spaces, and libraries with great WiFi, power outlets, 
            and the perfect atmosphere for your work style.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 md:gap-5 justify-center px-4">
            <SignedOut>
              <Link
                href="/sign-up"
                className="group w-full sm:w-auto px-8 md:px-10 py-4 md:py-5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto px-8 md:px-10 py-4 md:py-5 rounded-2xl border-2 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 font-semibold text-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all hover:scale-105 hover:border-zinc-400 dark:hover:border-zinc-600"
              >
                Learn More
              </a>
            </SignedOut>
            <SignedIn>
              <Link
                href="/ai"
                className="group w-full sm:w-auto px-8 md:px-10 py-4 md:py-5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-lg hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                Find Your Spot
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto px-8 md:px-10 py-4 md:py-5 rounded-2xl border-2 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 font-semibold text-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all hover:scale-105"
              >
                Learn More
              </a>
            </SignedIn>
          </div>

          {/* Install App CTA - Shows on mobile */}
          <div className="mt-8 md:hidden">
            <p className="text-xs text-zinc-500 flex items-center justify-center gap-2 p-3 rounded-xl bg-zinc-100 dark:bg-zinc-900">
              <Download className="w-4 h-4" />
              Install as app for the best experience
            </p>
          </div>
        </div>

        {/* Hero Mockup Image */}
        <div className={`relative max-w-6xl mx-auto mb-16 md:mb-24 px-4 transition-all duration-1000 delay-200 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-blue-500/20 border border-zinc-200/50 dark:border-zinc-800/50">
            <Image
              src="/images/hero-mockup.png"
              alt="WorkSphere - AI-Powered Remote Workspace Finder"
              width={1400}
              height={900}
              className="w-full h-auto"
              priority
            />
            {/* Gradient overlay at bottom */}
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white dark:from-black to-transparent" />
          </div>
          {/* Floating badges */}
          <div className="absolute -left-4 top-1/4 hidden lg:flex items-center gap-2 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white text-sm">Agent Pipeline</p>
              <p className="text-xs text-zinc-500">5-step AI reasoning</p>
            </div>
          </div>
          <div className="absolute -right-4 top-1/3 hidden lg:flex items-center gap-2 px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white text-sm">Smart Routes</p>
              <p className="text-xs text-zinc-500">Real-time directions</p>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-8 mb-16 md:mb-24 px-2 transition-all duration-1000 delay-300 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <FeatureCard
            icon={<Wifi className="w-5 h-5 md:w-6 md:h-6" />}
            title="WiFi Quality"
            description="Find spaces with reliable, fast internet perfect for video calls and heavy uploads."
            color="blue"
            delay={0}
          />
          <FeatureCard
            icon={<Volume2 className="w-5 h-5 md:w-6 md:h-6" />}
            title="Noise Levels"
            description="Filter by quiet zones for focus work or moderate noise for casual work sessions."
            color="green"
            delay={100}
          />
          <FeatureCard
            icon={<Zap className="w-5 h-5 md:w-6 md:h-6" />}
            title="Power Outlets"
            description="Never run out of battery. Find venues with plenty of accessible power outlets."
            color="yellow"
            delay={200}
          />
          <FeatureCard
            icon={<Clock className="w-5 h-5 md:w-6 md:h-6" />}
            title="Busy Times"
            description="Avoid crowds with insights on peak hours and best times to visit."
            color="purple"
            delay={300}
          />
          <FeatureCard
            icon={<MapPin className="w-5 h-5 md:w-6 md:h-6" />}
            title="Smart Routing"
            description="Get directions to your chosen workspace with estimated walking times."
            color="red"
            delay={400}
          />
          <FeatureCard
            icon={<Sparkles className="w-5 h-5 md:w-6 md:h-6" />}
            title="AI-Powered"
            description="Multi-agent AI understands your needs and finds the perfect match every time."
            color="indigo"
            delay={500}
          />
        </div>

        {/* How It Works */}
        <div className={`max-w-3xl mx-auto mb-16 md:mb-24 px-2 transition-all duration-1000 delay-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <h2 className="text-3xl md:text-4xl font-bold text-center text-zinc-900 dark:text-zinc-50 mb-4">
            How It Works
          </h2>
          <p className="text-center text-zinc-600 dark:text-zinc-400 mb-10 md:mb-14 max-w-xl mx-auto">
            Find your perfect workspace in just a few simple steps
          </p>
          
          <div className="space-y-8 md:space-y-10">
            <Step
              number={1}
              title="Tell us what you need"
              description="Just describe your ideal workspace in natural language: 'Find a quiet cafe with outlets near me'"
            />
            <Step
              number={2}
              title="AI finds the best matches"
              description="Our multi-agent system searches, scores, and ranks venues based on WiFi, noise, outlets, and more"
            />
            <Step
              number={3}
              title="Explore on the map"
              description="See all options on an interactive map with details, ratings, and directions"
            />
            <Step
              number={4}
              title="Share your experience"
              description="Help the community by rating venues you visit"
            />
          </div>
        </div>

        {/* CTA */}
        <div className={`text-center bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 rounded-3xl p-8 md:p-16 text-white mx-2 shadow-2xl shadow-purple-500/20 transition-all duration-1000 delay-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 md:mb-6">
            Ready to Find Your Perfect Workspace?
          </h2>
          <p className="text-lg md:text-xl mb-8 md:mb-10 text-blue-100 max-w-xl mx-auto">
            Join thousands of remote workers finding their ideal work spots
          </p>
          <Link
            href="/ai"
            className="group inline-flex items-center gap-2 w-full sm:w-auto px-8 md:px-10 py-4 md:py-5 rounded-2xl bg-white text-blue-600 font-bold text-lg hover:bg-zinc-100 transition-all shadow-xl hover:shadow-2xl hover:scale-105"
          >
            Get Started Free
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200/50 dark:border-zinc-800/50 py-8 md:py-12 mt-16 md:mt-24 bg-white/50 dark:bg-black/50 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-zinc-900 dark:text-zinc-50">WorkSphere</span>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
              Built with Next.js, AI SDK, and ❤️ for remote workers
            </p>
            <div className="flex items-center gap-4 text-sm text-zinc-500">
              <span>© 2024 WorkSphere</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
  delay = 0,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  delay?: number;
}) {
  const colorClasses: Record<string, { bg: string; icon: string; border: string }> = {
    blue: { 
      bg: "bg-blue-100 dark:bg-blue-900/30", 
      icon: "text-blue-600 dark:text-blue-400",
      border: "hover:border-blue-300 dark:hover:border-blue-700"
    },
    green: { 
      bg: "bg-green-100 dark:bg-green-900/30", 
      icon: "text-green-600 dark:text-green-400",
      border: "hover:border-green-300 dark:hover:border-green-700"
    },
    yellow: { 
      bg: "bg-yellow-100 dark:bg-yellow-900/30", 
      icon: "text-yellow-600 dark:text-yellow-400",
      border: "hover:border-yellow-300 dark:hover:border-yellow-700"
    },
    purple: { 
      bg: "bg-purple-100 dark:bg-purple-900/30", 
      icon: "text-purple-600 dark:text-purple-400",
      border: "hover:border-purple-300 dark:hover:border-purple-700"
    },
    red: { 
      bg: "bg-red-100 dark:bg-red-900/30", 
      icon: "text-red-600 dark:text-red-400",
      border: "hover:border-red-300 dark:hover:border-red-700"
    },
    indigo: { 
      bg: "bg-indigo-100 dark:bg-indigo-900/30", 
      icon: "text-indigo-600 dark:text-indigo-400",
      border: "hover:border-indigo-300 dark:hover:border-indigo-700"
    },
  };

  const colors = colorClasses[color];

  return (
    <div 
      className={`group p-5 md:p-7 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ${colors.border}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`inline-flex p-3 md:p-4 rounded-xl mb-4 md:mb-5 ${colors.bg} ${colors.icon} group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="text-lg md:text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2 md:mb-3">
        {title}
      </h3>
      <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400 leading-relaxed">{description}</p>
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
    <div className="group flex gap-4 md:gap-6 p-4 md:p-6 rounded-2xl hover:bg-zinc-100/50 dark:hover:bg-zinc-900/50 transition-colors">
      <div className="flex-shrink-0 relative">
        <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white flex items-center justify-center text-lg md:text-xl font-bold shadow-lg group-hover:scale-110 transition-transform">
          {number}
        </div>
        {number < 4 && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0.5 h-8 md:h-10 bg-gradient-to-b from-blue-600/50 to-transparent hidden md:block" />
        )}
      </div>
      <div className="pt-1">
        <h3 className="text-lg md:text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2 md:mb-3">
          {title}
        </h3>
        <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
