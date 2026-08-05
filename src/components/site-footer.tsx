"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { MessageSquare, Send, Check, Loader2 } from "lucide-react";

function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.79-.25.79-.55 0-.27-.01-1-.02-1.95-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.21.66.8.55A10.51 10.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  );
}

function Twitter({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.9 2H22l-7.2 8.23L23.3 22h-6.62l-5.19-6.79L5.5 22H2.4l7.7-8.8L1.7 2h6.78l4.69 6.2L18.9 2Zm-1.16 18h1.83L7.36 3.9H5.4L17.74 20Z" />
    </svg>
  );
}

function Linkedin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z" />
    </svg>
  );
}

export default function SiteFooter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setStatus("success");
      setMessage(data.message || "Subscribed successfully!");
      setEmail("");
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to subscribe. Please try again.");
    }
  };

  const footerLinks = {
    discover: [
      { name: "Find Workspaces", href: "/ai" },
      { name: "Dashboard", href: "/dashboard" },
      { name: "Features", href: "#features" },
      { name: "Live Updates", href: "/ai" },
    ],
    community: [
      {
        name: "GitHub Repository",
        href: "https://github.com/SatyamPandey-07/WorkSphere",
        external: true,
      },
      {
        name: "Contributors",
        href: "https://github.com/SatyamPandey-07/WorkSphere/contributors",
        external: true,
      },
      {
        name: "Open Source",
        href: "https://github.com/SatyamPandey-07/WorkSphere",
        external: true,
      },
    ],
    legal: [
      { name: "Privacy Policy", href: "/privacy" },
      { name: "Terms of Service", href: "/terms" },
      { name: "Cookie Settings", href: "#" },
    ],
  };

  const socialLinks = [
    {
      icon: <Github className="w-5 h-5" />,
      href: "https://github.com/SatyamPandey-07/WorkSphere",
      label: "GitHub",
    },
    {
      icon: <Twitter className="w-5 h-5" />,
      href: "https://twitter.com",
      label: "Twitter",
    },
    {
      icon: <Linkedin className="w-5 h-5" />,
      href: "https://linkedin.com",
      label: "LinkedIn",
    },
    {
      icon: <MessageSquare className="w-5 h-5" />,
      href: "https://discord.com",
      label: "Discord",
    },
  ];

  return (
    <footer
      role="contentinfo"
      aria-label="Footer Navigation"
      className="relative z-10 border-t border-zinc-200/50 dark:border-white/5 bg-zinc-50/80 dark:bg-black/30 backdrop-blur-md py-16 pb-28 sm:pb-16 text-zinc-600 dark:text-white/60"
    >
      {/* Decorative ambient gradient backdrop */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none opacity-40 dark:opacity-100">
        <div className="absolute -bottom-10 left-1/4 w-[500px] h-[300px] rounded-full bg-blue-600/5 dark:bg-blue-600/10 blur-[80px]" />
        <div className="absolute -bottom-10 right-1/4 w-[500px] h-[300px] rounded-full bg-purple-600/5 dark:bg-purple-600/10 blur-[80px]" />
      </div>

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-12">
          {/* Brand Identity Column */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <Link
              href="/"
              className="flex items-center gap-2.5 group w-fit focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 rounded-sm"
            >
              <Image
                src="/icons/icon-512.png"
                alt="WorkSphere logo"
                width={36}
                height={36}
                className="w-9 h-9 rounded-xl shadow-md shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-all duration-300"
              />{" "}
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 dark:from-blue-400 dark:via-purple-400 dark:to-cyan-400 bg-clip-text text-transparent">
                WorkSphere
              </span>
            </Link>

            <p className="text-sm leading-relaxed text-zinc-500 dark:text-white/40">
              AI-powered workspace discovery for remote workers. Find cafes,
              coworking hubs, and libraries with premium work-friendly
              amenities.
            </p>

            {/* Social handles with hover transitions */}
            <div className="flex items-center gap-3.5 mt-2">
              {socialLinks.map((social, index) => (
                <motion.a
                  key={index}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="w-9 h-9 rounded-xl bg-zinc-200/50 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 flex items-center justify-center text-zinc-600 dark:text-white/50 accent-text-hover transition-colors duration-200 border border-zinc-300/30 dark:border-white/5 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500"
                  whileHover={{ y: -3, scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {social.icon}
                </motion.a>
              ))}
            </div>
          </div>

          {/* Navigation Links Columns */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-6 sm:gap-8">
            {/* Column: Discover */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-900 dark:text-white">
                Discover
              </h3>
              <ul className="flex flex-col gap-2.5 text-sm">
                {footerLinks.discover.map((link, idx) => (
                  <li key={idx}>
                    <Link
                      href={link.href}
                      className="accent-text-hover transition-colors duration-200 block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 rounded-sm"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column: Community */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-900 dark:text-white">
                Community
              </h3>
              <ul className="flex flex-col gap-2.5 text-sm">
                {footerLinks.community.map((link, idx) => (
                  <li key={idx}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="accent-text-hover transition-colors duration-200 block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 rounded-sm"
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="accent-text-hover transition-colors duration-200 block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 rounded-sm"
                      >
                        {link.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Column: Legal */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-900 dark:text-white">
                Legal
              </h3>
              <ul className="flex flex-col gap-2.5 text-sm">
                {footerLinks.legal.map((link, idx) => (
                  <li key={idx}>
                    <Link
                      href={link.href}
                      className="accent-text-hover transition-colors duration-200 block focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 rounded-sm"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Column: Newsletter Form */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <h3 className="text-xs font-bold tracking-wider uppercase text-zinc-900 dark:text-white">
              Stay Connected
            </h3>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-white/40">
              Get weekly updates on premium workspace suggestions and newly
              added venues.
            </p>

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-2.5 mt-1"
            >
              <div className="relative flex items-center">
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  disabled={status === "loading" || status === "success"}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-zinc-300 dark:border-white/10 bg-white/70 dark:bg-white/5 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-white/30 focus:outline-none focus-visible:ring-2 accent-ring-20 transition-all disabled:opacity-50"
                  aria-label="Email Address for newsletter"
                />

                <div className="absolute right-1">
                  <button
                    type="submit"
                    disabled={
                      status === "loading" || status === "success" || !email
                    }
                    className="p-2 rounded-lg accent-bg text-white font-medium disabled:opacity-60 transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    aria-label="Subscribe"
                  >
                    {status === "loading" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : status === "success" ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Status messages with smooth motion transitions */}
              <AnimatePresence mode="wait">
                {message && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.2 }}
                    className={`text-xs font-medium ${status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                  >
                    {message}
                  </motion.p>
                )}
              </AnimatePresence>
            </form>
          </div>
        </div>

        {/* Footer Bottom Strip */}
        <div className="mt-12 flex justify-end text-xs text-zinc-400 dark:text-white/30">
          <p>© {new Date().getFullYear()} WorkSphere</p>
        </div>
      </div>
    </footer>
  );
}
