"use client";

import Link from "next/link";
import Image from "next/image";
import {
  MapPin, Wifi, Zap, Volume2, Clock, Sparkles, Download,
  ArrowRight, Coffee, Camera, Radio, Star, Users, Building2,
  ChevronRight, Globe
} from "lucide-react";
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
    <div className="min-h-screen bg-[#050510] text-white overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-blue-700/20 blur-[120px]"
          style={{ transform: `translateX(-50%) translateY(${scrollY * 0.05}px)` }}
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

      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-white/5 backdrop-blur-xl bg-black/40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-shadow">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              WorkSphere
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <SignedOut>
              <Link href="/sign-in">
                <button className="px-4 py-2 text-sm text-white/70 hover:text-white font-medium transition-colors">
                  Sign In
                </button>
              </Link>
              <Link href="/sign-up">
                <button className="px-5 py-2 text-sm rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:scale-105">
                  Get Started
                </button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link
                href="/ai"
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:text-white font-medium transition-colors"
              >
                <Coffee className="w-4 h-4" />
                Dashboard
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="container mx-auto px-4">
        <div className={`text-center max-w-5xl mx-auto pt-20 pb-16 transition-all duration-1000 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm text-white/70 mb-8 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
            </span>
            Real-time venue updates &nbsp;&bull;&nbsp; AI-Powered &nbsp;&bull;&nbsp; Free to use
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-8xl font-bold mb-6 tracking-tight leading-[1.05]">
            Find Your
            <br />
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Perfect Spot
              </span>
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                <path d="M2 8 Q75 2 150 8 Q225 14 298 8" stroke="url(#u)" strokeWidth="2.5" strokeLinecap="round"/>
                <defs>
                  <linearGradient id="u" x1="0" y1="0" x2="1" y2="0">
                    <stop stopColor="#60A5FA"/>
                    <stop offset="0.5" stopColor="#A78BFA"/>
                    <stop offset="1" stopColor="#22D3EE"/>
                  </linearGradient>
                </defs>
              </svg>
            </span>
          </h1>

          <p className="text-lg md:text-xl text-white/50 mb-10 max-w-2xl mx-auto leading-relaxed">
            AI-powered workspace discovery. Find cafes, coworking spaces, and libraries
            with great WiFi, power outlets, and the vibe that gets you in flow.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <SignedOut>
              <Link
                href="/sign-up"
                className="group px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-base hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                Start for Free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#features"
                className="px-8 py-4 rounded-2xl border border-white/10 bg-white/5 text-white/80 font-semibold text-base hover:bg-white/10 hover:border-white/20 transition-all backdrop-blur-sm"
              >
                See Features
              </a>
            </SignedOut>
            <SignedIn>
              <Link
                href="/ai"
                className="group px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold text-base hover:shadow-2xl hover:shadow-blue-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                Open Dashboard
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </SignedIn>
          </div>

          <p className="mt-6 text-xs text-white/30 md:hidden flex items-center justify-center gap-1.5">
            <Download className="w-3 h-3" />
            Install as an app for the best experience
          </p>
        </div>

        {/* Stats strip */}
        <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-20 transition-all duration-1000 delay-100 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          {[
            { value: "500+", label: "Venues indexed", icon: <Building2 className="w-4 h-4" /> },
            { value: "5-step", label: "AI agent pipeline", icon: <Sparkles className="w-4 h-4" /> },
            { value: "Live", label: "Real-time updates", icon: <Radio className="w-4 h-4" /> },
            { value: "Free", label: "No credit card", icon: <Star className="w-4 h-4" /> },
          ].map((stat, i) => (
            <div key={i} className="p-5 rounded-2xl border border-white/8 bg-white/4 backdrop-blur-sm text-center hover:border-white/15 hover:bg-white/6 transition-all">
              <div className="flex items-center justify-center gap-1.5 text-white/40 text-xs mb-2">
                {stat.icon}
                {stat.label}
              </div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Hero Mockup */}
        <div className={`relative max-w-5xl mx-auto mb-24 transition-all duration-1000 delay-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-600/30 via-purple-600/30 to-cyan-600/30 blur-xl" />
          <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
            <Image
              src="/images/hero-mockup.png"
              alt="WorkSphere App"
              width={1400}
              height={900}
              className="w-full h-auto"
              priority
            />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050510] to-transparent" />
          </div>
          {/* Floating chips */}
          <div className="absolute -left-6 top-1/4 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/80 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-semibold">AI Pipeline</p>
              <p className="text-white/40 text-xs">5-step reasoning</p>
            </div>
          </div>
          <div className="absolute -right-6 top-1/3 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/80 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Radio className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-semibold">Live Updates</p>
              <p className="text-white/40 text-xs">Real-time SSE stream</p>
            </div>
          </div>
          <div className="absolute -right-6 bottom-1/4 hidden lg:flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/80 border border-white/10 shadow-xl backdrop-blur-md">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-semibold">Venue Photos</p>
              <p className="text-white/40 text-xs">Powered by Pexels</p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div id="features" className={`mb-24 transition-all duration-1000 delay-300 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <div className="text-center mb-12">
            <span className="text-xs font-semibold tracking-widest text-blue-400 uppercase">Everything you need</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white mt-3 mb-4">Built for remote workers</h2>
            <p className="text-white/40 max-w-xl mx-auto">Every feature designed to help you find and enjoy the best workspace for your day.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard icon={<Wifi className="w-5 h-5" />} title="WiFi Quality" description="Find spaces with reliable, fast internet perfect for video calls and heavy uploads." accent="blue" />
            <FeatureCard icon={<Volume2 className="w-5 h-5" />} title="Noise Levels" description="Filter by quiet zones for deep focus or moderate noise for casual sessions." accent="green" />
            <FeatureCard icon={<Zap className="w-5 h-5" />} title="Power Outlets" description="Never run out of battery. Find venues with accessible power outlets nearby." accent="yellow" />
            <FeatureCard icon={<Clock className="w-5 h-5" />} title="Busy Times" description="Avoid crowds with insights on peak hours and the best times to visit." accent="purple" />
            <FeatureCard icon={<Camera className="w-5 h-5" />} title="Venue Photos" description="Browse beautiful real photos of every workspace before you visit, powered by Pexels." accent="pink" isNew />
            <FeatureCard icon={<Radio className="w-5 h-5" />} title="Real-time Updates" description="Live venue availability, new ratings, and crowd info stream directly to your screen." accent="cyan" isNew />
            <FeatureCard icon={<MapPin className="w-5 h-5" />} title="Smart Routing" description="OSRM-powered real road directions, not straight lines, to your chosen workspace." accent="red" />
            <FeatureCard icon={<Sparkles className="w-5 h-5" />} title="AI-Powered" description="5-agent pipeline understands plain English queries and finds the perfect match." accent="indigo" />
          </div>
        </div>

        {/* How it works */}
        <div className={`max-w-3xl mx-auto mb-24 transition-all duration-1000 delay-500 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <div className="text-center mb-12">
            <span className="text-xs font-semibold tracking-widest text-purple-400 uppercase">Simple as it gets</span>
            <h2 className="text-3xl md:text-4xl font-bold text-white mt-3">How it works</h2>
          </div>
          <div className="space-y-4">
            {[
              { n: 1, title: "Tell the AI what you need", desc: "Just type naturally: \"Find a quiet cafe with good WiFi and outlets near me\"" },
              { n: 2, title: "5 agents work in parallel", desc: "Orchestrator, Context, Data, Reasoning, and Action agents collaborate to find and rank the best matches." },
              { n: 3, title: "Explore with photos on the map", desc: "See all options on a dark interactive map with real photos, ratings, and routing." },
              { n: 4, title: "Rate & help the community", desc: "Share your experience to help other remote workers find the perfect spot." },
            ].map((step) => (
              <Step key={step.n} number={step.n} title={step.title} description={step.desc} />
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className={`relative rounded-3xl overflow-hidden mb-24 mx-2 transition-all duration-1000 delay-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-700 to-cyan-700" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
          <div className="relative p-12 md:p-20 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-sm mb-6 backdrop-blur-sm border border-white/20">
              <Users className="w-4 h-4" />
              Join remote workers worldwide
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
              Ready to find your<br />perfect workspace?
            </h2>
            <p className="text-blue-100/70 text-lg mb-10 max-w-lg mx-auto">
              No credit card. No setup. Just great workspaces.
            </p>
            <Link
              href="/ai"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white text-blue-700 font-bold text-base hover:bg-zinc-100 transition-all shadow-2xl hover:shadow-white/20 hover:scale-105"
            >
              Get Started Free
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 bg-black/30 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white">WorkSphere</span>
            </div>
            <p className="text-sm text-white/30 text-center">
              Built with Next.js 15, AI SDK &amp; ❤️ for remote workers
            </p>
            <div className="flex items-center gap-4 text-xs text-white/30">
              <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white/60 transition-colors">
                <Globe className="w-3 h-3" />
                Photos by Pexels
              </a>
              <span>© 2026 WorkSphere</span>
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
    blue:   { glow: "hover:shadow-blue-500/20",   text: "text-blue-400",   bg: "bg-blue-500/10" },
    green:  { glow: "hover:shadow-green-500/20",  text: "text-green-400",  bg: "bg-green-500/10" },
    yellow: { glow: "hover:shadow-yellow-500/20", text: "text-yellow-400", bg: "bg-yellow-500/10" },
    purple: { glow: "hover:shadow-purple-500/20", text: "text-purple-400", bg: "bg-purple-500/10" },
    pink:   { glow: "hover:shadow-pink-500/20",   text: "text-pink-400",   bg: "bg-pink-500/10" },
    cyan:   { glow: "hover:shadow-cyan-500/20",   text: "text-cyan-400",   bg: "bg-cyan-500/10" },
    red:    { glow: "hover:shadow-red-500/20",     text: "text-red-400",    bg: "bg-red-500/10" },
    indigo: { glow: "hover:shadow-indigo-500/20", text: "text-indigo-400", bg: "bg-indigo-500/10" },
  };
  const a = accents[accent];
  return (
    <div className={`relative group p-6 rounded-2xl border border-white/8 bg-white/4 hover:bg-white/6 hover:border-white/15 hover:shadow-xl ${a.glow} hover:-translate-y-1 transition-all duration-300 backdrop-blur-sm`}>
      {isNew && (
        <span className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-blue-500 to-purple-500 text-white">
          NEW
        </span>
      )}
      <div className={`inline-flex p-3 rounded-xl mb-5 ${a.bg} ${a.text} group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="text-base font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/40 leading-relaxed">{description}</p>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="group flex gap-5 p-5 rounded-2xl border border-white/5 bg-white/3 hover:bg-white/5 hover:border-white/10 transition-all backdrop-blur-sm">
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 text-white flex items-center justify-center text-sm font-bold shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
          {number}
        </div>
      </div>
      <div>
        <h3 className="text-base font-bold text-white mb-1.5">{title}</h3>
        <p className="text-sm text-white/40 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}