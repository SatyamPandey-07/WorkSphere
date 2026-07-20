"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Shield,
  Lock,
  Eye,
  ShieldAlert,
  CheckCircle,
  Mail,
  MapPin,
} from "lucide-react";
import SiteFooter from "@/components/site-footer";

const sections = [
  { id: "introduction", label: "Introduction" },
  { id: "info-collect", label: "Information We Collect" },
  { id: "info-use", label: "How We Use Information" },
  { id: "cookies", label: "Cookies & Local Storage" },
  { id: "security", label: "Data Security" },
  { id: "rights", label: "Your Rights & Choices" },
  { id: "updates", label: "Updates to Policy" },
];

export default function PrivacyPolicyPage() {
  const [activeSection, setActiveSection] = useState("introduction");

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element) {
          const top = element.offsetTop;
          const height = element.offsetHeight;

          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = element.offsetTop - 100;
      window.scrollTo({
        top: offset,
        behavior: "smooth",
      });
      setActiveSection(id);
    }
  };

  return (
    <div className="min-h-screen bg-[#050510] text-white flex flex-col justify-between overflow-x-hidden selection:bg-blue-500 selection:text-white">
      {/* Background neon blur blobs */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-blue-700/10 blur-[130px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-purple-700/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      {/* Header Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#050510]/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 max-w-6xl flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-all duration-300">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              WorkSphere
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Page Title & Main Content Grid */}
      <main className="container mx-auto px-4 py-12 max-w-6xl flex-grow">
        <div className="mb-12">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full accent-border-30 accent-bg-10 accent-text text-xs font-semibold mb-4 backdrop-blur-sm">
            <Shield className="w-3.5 h-3.5" />
            Privacy Policy
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
            Privacy Policy
          </h1>
          <p className="text-white/40 text-xs font-mono mt-3">
            Last Updated: July 9, 2026
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Sticky Sidebar Navigation */}
          <aside className="lg:col-span-4 sticky top-28 hidden lg:block">
            <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
                Navigation List
              </h3>
              <nav className="flex flex-col gap-1">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      activeSection === section.id
                        ? "text-white shadow-md shadow-[var(--primary-accent)]/10"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                    style={
                      activeSection === section.id
                        ? {
                            background: `linear-gradient(to right, var(--primary-accent), color-mix(in srgb, var(--primary-accent) 70%, #7c3aed))`,
                          }
                        : undefined
                    }
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Legal Text Sections */}
          <article className="lg:col-span-8 space-y-12 leading-relaxed text-white/80">
            {/* 1. Introduction */}
            <section id="introduction" className="space-y-4 pt-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                Introduction
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  Welcome to WorkSphere. We value your privacy and are committed
                  to protecting your personal data. This Privacy Policy
                  describes how we collect, use, process, and disclose your
                  information when you access or use the WorkSphere platform.
                </p>
                <p>
                  By accessing or using WorkSphere, you agree to the collection
                  and use of information in accordance with this policy. If you
                  do not agree with any terms in this policy, please discontinue
                  use of our service immediately.
                </p>
              </div>
            </section>

            {/* 2. Information We Collect */}
            <section id="info-collect" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-purple-500" />
                Information We Collect
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  We collect information to provide a tailored, feature-rich
                  workspace search experience. This includes:
                </p>
                <ul className="space-y-3.5 list-none pl-0">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      <strong>Account Information:</strong> If you sign up or
                      log in via Clerk, we collect your email address, first
                      name, last name, and profile picture.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      <strong>Usage & Search Parameters:</strong> We track
                      search parameters such as wifi requirements, noise
                      preferences, target category, and approximate search
                      radius.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      <strong>Booking details:</strong> When you book a
                      workspace, we store confirmation details, schedules,
                      customer email, and optionally a phone number.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      <strong>Geolocation Data:</strong> We access your
                      coordinates with your explicit consent to find workspaces
                      in your proximity.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            {/* 3. How We Use Information */}
            <section id="info-use" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-cyan-500" />
                How We Use Information
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  We process your personal information for the following
                  legitimate business purposes:
                </p>
                <ul className="space-y-3.5 list-none pl-0">
                  <li className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-blue-400 mt-1 shrink-0" />
                    <span>
                      To run, maintain, and optimize the AI workspace finder
                      recommendation engine.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-blue-400 mt-1 shrink-0" />
                    <span>
                      To dispatch secure transactional email confirmations for
                      reservation bookings.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-blue-400 mt-1 shrink-0" />
                    <span>
                      To monitor overall system performance, analytics counters,
                      and prevent system abuse.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-blue-400 mt-1 shrink-0" />
                    <span>
                      To deliver newsletter email updates, if you opt in.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            {/* 4. Cookies & Local Storage */}
            <section id="cookies" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                Cookies & Local Storage
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  WorkSphere utilizes local storage and authentication cookies
                  (via Clerk) to maintain user session persistence and secure
                  access.
                </p>
                <p>
                  We also use cookies for caching search history and UI
                  preferences. You can configure your browser to reject all
                  cookies, but certain core features of the search application
                  may become disabled.
                </p>
              </div>
            </section>

            {/* 5. Data Security */}
            <section id="security" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-purple-500" />
                Data Security
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-amber-400 mt-1 shrink-0 animate-pulse" />
                  <span>
                    Our primary database is hosted on Supabase (PostgreSQL),
                    protected with modern TLS encryption protocols. User
                    authentication flows are managed entirely through Clerk,
                    ensuring no passwords or sensitive login credentials ever
                    touch or reside on our database servers.
                  </span>
                </p>
                <p>
                  While we implement strong industrial safeguards, no method of
                  transmission or digital storage is 100% secure. Therefore, we
                  cannot guarantee absolute security.
                </p>
              </div>
            </section>

            {/* 6. Your Rights & Choices */}
            <section id="rights" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-cyan-500" />
                Your Rights & Choices
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  Depending on your legal jurisdiction (such as GDPR or CCPA),
                  you possess the following rights:
                </p>
                <ul className="space-y-3.5 list-none pl-0">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      The right to access, edit, or delete your account records
                      directly via the Clerk User Profile modal.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      The right to unsubscribe from our newsletter lists by
                      clicking the link at the bottom of any email.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      The right to request deletion of all your booking history
                      from our local database.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            {/* 7. Updates to Policy */}
            <section id="updates" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                Updates to Policy
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p className="flex items-start gap-3">
                  <ShieldAlert className="w-4 h-4 text-rose-400 mt-1 shrink-0" />
                  <span>
                    We may update our Privacy Policy periodically to reflect
                    shifts in our legal structure, scaling features, or changes
                    in regulatory guidelines. Any modifications will be posted
                    here with a revised "Last Updated" timestamp.
                  </span>
                </p>
                <p className="flex items-center gap-2 text-white/50 text-sm">
                  <Mail className="w-4 h-4 accent-text" />
                  <span>
                    Have inquiries? Contact us at:{" "}
                    <a
                      href="mailto:support@worksphere.io"
                      className="accent-text hover:underline"
                    >
                      support@worksphere.io
                    </a>
                  </span>
                </p>
              </div>
            </section>
          </article>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
