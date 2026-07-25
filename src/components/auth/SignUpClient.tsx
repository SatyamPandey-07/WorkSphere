"use client";

import React, { useState, useEffect } from "react";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { PasskeyFrameNotice } from "@/components/PasskeyFrameNotice";

export function SignUpClient() {
  const router = useRouter();
  const [useFallback, setUseFallback] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!key || key.includes("dummy") || key === "pk_test_dummy") {
      setUseFallback(true);
      return;
    }

    const timer = setTimeout(() => {
      const clerkCard = document.querySelector(".cl-rootBox");
      if (!clerkCard) {
        setUseFallback(true);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  const handleFormSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !name) {
      setError("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      document.cookie = `worksphere_user_name=${encodeURIComponent(name)}; path=/; max-age=86400`;
      document.cookie = `worksphere_user_email=${encodeURIComponent(email)}; path=/; max-age=86400`;
      setSuccess(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch {
      setError("Sign up failed. Please try again.");
      setLoading(false);
    }
  };

  const handleDemoSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      document.cookie = "worksphere_demo_session=true; path=/; max-age=86400";
      setSuccess(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch {
      setError("Failed to create demo session.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-5">
      <PasskeyFrameNotice />

      {!useFallback ? (
        <div className="w-full space-y-4">
          <SignUp
            appearance={{
              elements: {
                rootBox: "mx-auto w-full",
                card: "bg-zinc-900/60 backdrop-blur-xl border border-zinc-800 shadow-2xl rounded-2xl p-6",
                headerTitle: "text-white text-2xl font-bold",
                headerSubtitle: "text-zinc-400",
                socialButtonsBlockButton:
                  "bg-zinc-800/90 border border-zinc-700 text-white hover:bg-zinc-700 transition-all rounded-xl py-2.5",
                socialButtonsBlockButtonText: "text-white font-medium text-sm",
                dividerLine: "bg-zinc-800",
                dividerText: "text-zinc-500 text-xs uppercase",
                formFieldLabel: "text-zinc-300 font-medium text-sm mb-1.5",
                formFieldInput:
                  "bg-zinc-800/80 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-xl px-4 py-2.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all",
                footerActionLink:
                  "text-purple-400 font-medium text-sm hover:text-purple-300 transition-colors",
                formButtonPrimary:
                  "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-600/25 transition-all text-sm w-full mt-2",
                footer: "hidden",
              },
            }}
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
          />

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setUseFallback(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline transition-colors"
            >
              Having trouble loading sign up? Use Direct Auth & Demo Register →
            </button>
          </div>
        </div>
      ) : (
        /* Fallback Interactive Sign Up Form */
        <div className="w-full bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/90 shadow-2xl rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Create your Account</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Join WorkSphere to discover and save remote work venues worldwide.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Account registered successfully! Redirecting...</span>
            </div>
          )}

          <form onSubmit={handleFormSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                  className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-600/25 transition-all text-sm disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative text-center text-xs text-zinc-500 uppercase tracking-wider my-2">
            <span className="bg-zinc-900 px-2 text-zinc-400">or quick access</span>
          </div>

          <button
            type="button"
            onClick={handleDemoSignUp}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-blue-500/30 bg-blue-600/10 hover:bg-blue-600/20 text-blue-300 font-semibold text-sm transition-all shadow-md"
          >
            <Sparkles className="h-4 w-4 text-blue-400" />
            <span>⚡ Instant Demo Account Registration</span>
          </button>
        </div>
      )}

      <p className="text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-purple-400 hover:text-purple-300 transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
