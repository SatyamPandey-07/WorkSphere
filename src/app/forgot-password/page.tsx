"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { Mail, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2, Loader2, MapPin } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { isLoaded, signIn } = useSignIn();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (!isLoaded || !signIn) {
      setError("Authentication service is initializing. Please try again in a moment.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Initiate Clerk's native password recovery flow
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: cleanEmail,
      });

      setSuccess(true);

      // Redirect user to reset-password page with email pre-populated
      setTimeout(() => {
        router.push(`/reset-password?email=${encodeURIComponent(cleanEmail)}`);
      }, 1200);
    } catch (err: unknown) {
      if (isClerkAPIResponseError(err)) {
        const firstError = err.errors[0];
        setError(firstError?.longMessage || firstError?.message || "Failed to initiate password reset.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-zinc-950 via-blue-950/20 to-zinc-950">
      <div className="w-full max-w-md bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/90 shadow-2xl rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center gap-2 group mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              WorkSphere
            </span>
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Forgot your password?
          </h1>
          <p className="text-sm text-zinc-400">
            Enter your email and we will send you a verification code to reset your password.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="forgot-password-error-banner"
            className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div
            role="status"
            data-testid="forgot-password-success-banner"
            className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Verification code sent! Redirecting to password reset...</span>
          </div>
        )}

        <form data-testid="forgot-password-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="email"
                name="email"
                id="email"
                data-testid="forgot-password-email-input"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="forgot-password-submit-btn"
            disabled={loading || success}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-600/25 transition-all text-sm disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <span>Send Reset Code</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2">
          <Link
            href="/sign-in"
            data-testid="forgot-password-back-to-signin"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
