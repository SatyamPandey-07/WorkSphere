"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Github, Twitter, Linkedin, MessageSquare, Send, Check, Loader2 } from "lucide-react";

export default function SiteFooter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
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
      { name: "GitHub Repository", href: "https://github.com/SatyamPandey-07/WorkSphere", external: true },
      { name: "Contributors", href: "https://github.com/SatyamPandey-07/WorkSphere/contributors", external: true },
      { name: "Open Source", href: "https://github.com/SatyamPandey-07/WorkSphere", external: true },
    ],
    legal: [
      { name: "Privacy Policy", href: "/privacy" },
      { name: "Terms of Service", href: "/terms" },
      { name: "Cookie Settings", href: "#" },
    ],
  };

  const socialLinks = [
    { icon: <Github className="w-5 h-5" />, href: "https://github.com/SatyamPandey-07/WorkSphere", label: "GitHub" },
    { icon: <Twitter className="w-5 h-5" />, href: "https://twitter.com", label: "Twitter" },
    { icon: <Linkedin className="w-5 h-5" />, href: "https://linkedin.com", label: "LinkedIn" },
    { icon: <MessageSquare className="w-5 h-5" />, href: "https://discord.com", label: "Discord" },
  ];

  return (
    <footer className="relative z-10 border-t border-zinc-200/50 dark:border-white/5 bg-zinc-50/80 dark:bg-black/30 backdrop-blur-md py-16 text-zinc-600 dark:text-white/60">
      {/* Decorative ambient gradient backdrop */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none opacity-40 dark:opacity-100">
        <div className="absolute -bottom-10 left-1/4 w-[500px] h-[300px] rounded-full bg-blue-600/5 dark:bg-blue-600/10 blur-[80px]" />
        <div className="absolute -bottom-10 right-1/4 w-[500px] h-[300px] rounded-full bg-purple-600/5 dark:bg-purple-600/10 blur-[80px]" />
      </div>

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-12">
          {/* Brand Identity Column */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2.5 group w-fit">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-all duration-300">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 dark:from-blue-400 dark:via-purple-400 dark:to-cyan-400 bg-clip-text text-transparent">
                WorkSphere
              </span>
            </Link>

            <p className="text-sm leading-relaxed text-zinc-500 dark:text-white/40">
              AI-powered workspace discovery for remote workers. Find cafes, coworking hubs, and libraries with premium work-friendly amenities.
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
                  className="w-9 h-9 rounded-xl bg-zinc-200/50 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 flex items-center justify-center text-zinc-600 dark:text-white/50 hover:text-blue-600 dark:hover:text-white transition-colors duration-200 border border-zinc-300/30 dark:border-white/5"
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
                    <Link href={link.href} className="hover:text-blue-600 dark:hover:text-white transition-colors duration-200 block">
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
                        className="hover:text-blue-600 dark:hover:text-white transition-colors duration-200 block"
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link href={link.href} className="hover:text-blue-600 dark:hover:text-white transition-colors duration-200 block">
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
                    <Link href={link.href} className="hover:text-blue-600 dark:hover:text-white transition-colors duration-200 block">
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
              Get weekly updates on premium workspace suggestions and newly added venues.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 mt-1">
              <div className="relative flex items-center">
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  disabled={status === "loading" || status === "success"}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-zinc-300 dark:border-white/10 bg-white/70 dark:bg-white/5 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-500/30 transition-all disabled:opacity-50"
                  aria-label="Email Address for newsletter"
                />

                <div className="absolute right-1">
                  <button
                    type="submit"
                    disabled={status === "loading" || status === "success" || !email}
                    className="p-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium disabled:opacity-60 transition-colors flex items-center justify-center"
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
          <p>© 2026 WorkSphere</p>
        </div>
      </div>
    </footer>
  );
}
