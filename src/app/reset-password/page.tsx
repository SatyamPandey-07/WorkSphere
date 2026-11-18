"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import {
  Lock,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, signIn, setActive } = useSignIn();

  const initialEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Cooldown countdown effect
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Client-side password complexity checker
  const validatePasswordStrength = (pwd: string): string | null => {
    if (pwd.length < 8) return "Password must be at least 8 characters long.";
    if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(pwd)) return "Password must contain at least one lowercase letter.";
    if (!/\d/.test(pwd)) return "Password must contain at least one number.";
    return null;
  };

  const handleResendCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Please provide your email address to resend the code.");
      return;
    }
    if (!isLoaded || !signIn) {
      setError("Authentication service is initializing. Please try again.");
      return;
    }
    if (cooldown > 0) return;

    setResending(true);
    setError(null);
    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: cleanEmail,
      });
      setCooldown(60); // 60s cooldown
    } catch (err: unknown) {
      if (isClerkAPIResponseError(err)) {
        const firstError = err.errors[0];
        setError(firstError?.longMessage || firstError?.message || "Failed to resend code.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unable to resend verification code. Please try again.");
      }
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim();

    if (!cleanCode) {
      setError("Please enter the verification code.");
      return;
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      setError(strengthError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!isLoaded || !signIn) {
      setError("Authentication service is initializing. Please try again.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If sign-in attempt was lost or not initialized, initialize with email
      if (signIn.status !== "needs_first_factor" && email.trim()) {
        await signIn.create({
          strategy: "reset_password_email_code",
          identifier: email.trim().toLowerCase(),
        });
      }

      // Authoritatively attempt reset factor verification
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: cleanCode,
        password,
      });

      if (result.status === "complete") {
        setSuccess(true);

        // Authoritatively set the new active session in Clerk if session created
        if (result.createdSessionId && setActive) {
          await setActive({ session: result.createdSessionId });
        }

        setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1200);
      } else {
        setError(
          "Password updated, but additional verification is required. Please sign in.",
        );
        setTimeout(() => {
          router.push("/sign-in");
        }, 1500);
      }
    } catch (err: unknown) {
      if (isClerkAPIResponseError(err)) {
        const firstError = err.errors[0];
        setError(firstError?.longMessage || firstError?.message || "Password reset failed.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Invalid or expired verification code. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
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
          Reset your password
        </h1>
        <p className="text-sm text-zinc-400">
          Enter the verification code sent to your email and your new password.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="reset-password-error-banner"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          role="status"
          data-testid="reset-password-success-banner"
          className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Password reset successful! Redirecting to dashboard...</span>
        </div>
      )}

      <form data-testid="reset-password-form" onSubmit={handleSubmit} className="space-y-4">
        {!initialEmail && (
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2"
            >
              Email Address
            </label>
            <input
              type="email"
              name="email"
              id="email"
              data-testid="reset-password-email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="code"
              className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider"
            >
              Verification Code
            </label>
            <button
              type="button"
              data-testid="reset-password-resend-btn"
              onClick={handleResendCode}
              disabled={resending || cooldown > 0 || !email}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:text-zinc-600 transition-colors inline-flex items-center gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} />
              <span>{cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}</span>
            </button>
          </div>
          <div className="relative">
            <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              name="code"
              id="code"
              data-testid="reset-password-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter 6-digit code"
              maxLength={12}
              className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm tracking-wider focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              required
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2"
          >
            New Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              id="password"
              data-testid="reset-password-new-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              required
            />
            <button
              type="button"
              data-testid="reset-password-toggle-password-btn"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2"
          >
            Confirm New Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              id="confirmPassword"
              data-testid="reset-password-confirm-password-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-zinc-800/70 border border-zinc-700/80 text-white placeholder:text-zinc-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          data-testid="reset-password-submit-btn"
          disabled={loading || success}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-blue-600/25 transition-all text-sm disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <span>Reset Password</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="text-center pt-2">
        <Link
          href="/sign-in"
          data-testid="reset-password-back-to-signin"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Sign In</span>
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-zinc-950 via-blue-950/20 to-zinc-950">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-zinc-900/80 border border-zinc-800 p-8 rounded-2xl flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        }
      >
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
