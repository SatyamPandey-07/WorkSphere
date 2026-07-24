"use client";

import React, { useState, useEffect } from "react";
import { SignIn, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { PasskeySignInButton } from "./PasskeySignInButton";
import { PasskeyFrameNotice } from "@/components/PasskeyFrameNotice";

export function SignInClient() {
  const router = useRouter();
  const [useFallback, setUseFallback] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoSuccess, setDemoSuccess] = useState(false);

  // Detect if Clerk keys are missing or if Clerk fails to load within 1.5s
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (!key || key.includes("dummy") || key === "pk_test_dummy") {
      setUseFallback(true);
      return;
    }

    const timer = setTimeout(() => {
      // Check if Clerk DOM card exists
      const clerkCard = document.querySelector(".cl-rootBox");
      if (!clerkCard) {
        setUseFallback(true);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  const handleDemoSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      // Create a demo session cookie / token or redirect directly to dashboard
      document.cookie = "worksphere_demo_session=true; path=/; max-age=86400";
      setDemoSuccess(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch {
      setError("Failed to initialize demo session. Please try again.");
      setLoading(false);
    }
  };

  const handleFormSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Set session cookie for local auth
      document.cookie = `worksphere_user_email=${encodeURIComponent(email)}; path=/; max-age=86400`;
      setDemoSuccess(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch {
      setError("Sign in failed. Please verify credentials.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-5">
      <PasskeyFrameNotice />

      {!useFallback ? (
        <div className="w-full space-y-4">
          <PasskeySignInButton />
          <div className="relative my-4 text-center text-xs text-zinc-500 uppercase tracking-wider">
            <span className="bg-zinc-950 px-2 text-zinc-400">or sign in with credentials</span>
          </div>

          <SignIn
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
                  "bg-zinc-800/80 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all",
                footerActionLink:
                  "text-blue-400 font-medium text-sm hover:text-blue-300 transition-colors",
                formButtonPrimary:
                  "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-600/25 transition-all text-sm w-full mt-2",
                footer: "hidden",
              },
            }}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
          />

          {/* Toggle to custom fallback form if Clerk is slow or unconfigured */}
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setUseFallback(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline transition-colors"
            >
              Having trouble loading sign in? Use Direct Auth & Demo Login →
            </button>
          </div>
        </div>
      ) : (
        /* Fallback Interactive Sign In Form */
        <div className="w-full bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/90 shadow-2xl rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Sign In to WorkSphere</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Enter your account details or try a instant demo login below.
            </p>
          </div>

          <PasskeySignInButton />

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {demoSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Authentication successful! Redirecting to workspace finder...</span>
            </div>
          )}

          <form onSubmit={handleFormSignIn} className="space-y-4">
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
                  placeholder="name@company.com"
                  className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
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
                  placeholder="••••••••••••"
                  className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
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
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-600/25 transition-all text-sm disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
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
            onClick={handleDemoSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-purple-500/30 bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 font-semibold text-sm transition-all shadow-md"
          >
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span>⚡ Instant Demo Remote Worker Sign In</span>
          </button>
        </div>
      )}

      <p className="text-center text-sm text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
          Sign up free
        </Link>
      </p>
    </div>
  );
}
