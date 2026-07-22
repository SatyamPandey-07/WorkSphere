"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Scale,
  Lock,
  ShieldAlert,
  CheckCircle,
  Mail,
  MapPin,
} from "lucide-react";
import SiteFooter from "@/components/site-footer";

const sections = [
  { id: "agreement", label: "Acceptance of Terms" },
  { id: "services", label: "Description of Service" },
  { id: "accounts", label: "User Accounts" },
  { id: "conduct", label: "User Conduct & Booking Rules" },
  { id: "intellectual", label: "Intellectual Property" },
  { id: "liability", label: "Limitation of Liability" },
  { id: "termination", label: "Termination & Law" },
];

export default function TermsOfServicePage() {
  const [activeSection, setActiveSection] = useState("agreement");

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
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-purple-700/10 blur-[130px]" />
        <div className="absolute bottom-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-blue-700/10 blur-[120px]" />
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
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-xs font-semibold text-purple-400 mb-4 backdrop-blur-sm">
            <Scale className="w-3.5 h-3.5" />
            Terms of Service
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
            Terms of Service
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
            {/* 1. Acceptance of Terms */}
            <section id="agreement" className="space-y-4 pt-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                Acceptance of Terms
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  By accessing or using the WorkSphere application, web
                  platform, and related services, you agree to be bound by these
                  Terms of Service. These Terms constitute a binding legal
                  agreement between you and WorkSphere.
                </p>
                <p>
                  If you are entering into these terms on behalf of a company or
                  other legal entity, you represent that you have the authority
                  to bind such entity. If you do not agree to these terms, do
                  not access or use our services.
                </p>
              </div>
            </section>

            {/* 2. Description of Service */}
            <section id="services" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-purple-500" />
                Description of Service
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  WorkSphere provides an AI-powered workspace discovery and
                  booking directory. We help remote workers find suitable cafes,
                  coworking hubs, libraries, and other spaces by matching user
                  requirements with physical amenities (such as WiFi, outlets,
                  and noise levels).
                </p>
                <p>
                  WorkSphere reserves the right to modify, suspend, or
                  discontinue any aspect of the service at any time without
                  prior notice or liability.
                </p>
              </div>
            </section>

            {/* 3. User Accounts */}
            <section id="accounts" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-cyan-500" />
                User Accounts
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-amber-400 mt-1 shrink-0" />
                  <span>
                    To access advanced features (like marking favorites, rating
                    venues, and making reservations), you must authenticate via
                    Clerk. You are responsible for keeping your login
                    credentials secure.
                  </span>
                </p>
                <p>
                  You agree to notify us immediately of any unauthorized use of
                  your account. WorkSphere will not be liable for any loss or
                  damage arising from your failure to protect your login
                  information.
                </p>
              </div>
            </section>

            {/* 4. User Conduct & Booking Rules */}
            <section id="conduct" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                User Conduct & Booking Rules
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  When using WorkSphere, you agree to adhere to the following
                  rules of conduct:
                </p>
                <ul className="space-y-3.5 list-none pl-0">
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      Provide accurate, complete booking information (valid
                      email and optional phone details).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      Do not create fraudulent bookings or reservations you do
                      not intend to honor.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      Do not submit false, misleading, or abusive venue
                      reviews/ratings.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400 mt-1 shrink-0" />
                    <span>
                      Do not deploy automated bots, scrapers, or scripts that
                      overload or abuse our API endpoints.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            {/* 5. Intellectual Property */}
            <section id="intellectual" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-purple-500" />
                Intellectual Property
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  All content, branding logos, user interface assets,
                  illustrations, database records, and software code on
                  WorkSphere are the exclusive property of WorkSphere and its
                  contributors.
                </p>
                <p>
                  You are granted a limited, revocable, non-transferable license
                  to access our platform for personal, non-commercial use. Any
                  unauthorized reproduction, scraping, or redistribution of our
                  data is strictly prohibited.
                </p>
              </div>
            </section>

            {/* 6. Limitation of Liability */}
            <section id="liability" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-cyan-500" />
                Limitation of Liability
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p className="flex items-start gap-3">
                  <ShieldAlert className="w-4 h-4 text-amber-500 mt-1 shrink-0 animate-pulse" />
                  <span>
                    WorkSphere acts solely as a discovery directory. We do not
                    own, manage, or operate any of the listed workspaces or
                    cafes. We provide data "as is" and make no warranties
                    regarding WiFi speed, outlet availability, or overall
                    workspace quality.
                  </span>
                </p>
                <p>
                  WorkSphere shall not be liable for any indirect, incidental,
                  special, or consequential damages resulting from your use of,
                  or inability to use, our workspace search and booking
                  features.
                </p>
              </div>
            </section>

            {/* 7. Termination & Governing Law */}
            <section id="termination" className="space-y-4 scroll-mt-28">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-6 rounded-full bg-blue-500" />
                Termination & Governing Law
              </h2>
              <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <p>
                  We reserve the right to terminate or suspend access to our
                  application immediately, without prior notice, if you breach
                  any provision of these Terms of Service.
                </p>
                <p>
                  These Terms shall be governed by and construed in accordance
                  with the laws of your jurisdiction, without regard to conflict
                  of law principles.
                </p>
                <p className="flex items-center gap-2 text-white/50 text-sm mt-4">
                  <Mail className="w-4 h-4 accent-text" />
                  <span>
                    Have questions regarding these Terms? Support:{" "}
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
