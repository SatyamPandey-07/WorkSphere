import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { MapPin, Sparkles } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-zinc-950 via-blue-950/20 to-zinc-950">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 bg-gradient-to-br from-blue-600/10 via-purple-600/10 to-cyan-600/10 border-r border-zinc-800">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            WorkSphere
          </span>
        </Link>

        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Welcome back to<br />
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              your workspace finder
            </span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-md">
            Sign in to discover perfect workspaces with AI-powered recommendations tailored to your needs.
          </p>
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 max-w-md">
            <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">AI-Powered Search</p>
              <p className="text-xs text-zinc-500">Find workspaces that match your exact needs</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-zinc-600">
          © 2024 WorkSphere. Built for remote workers everywhere.
        </p>
      </div>

      {/* Right Side - Sign In Form */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                WorkSphere
              </span>
            </Link>
          </div>

          <SignIn
            appearance={{
              elements: {
                rootBox: "mx-auto w-full",
                card: "bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 shadow-2xl rounded-2xl",
                headerTitle: "text-white text-2xl font-bold",
                headerSubtitle: "text-zinc-400",
                socialButtonsBlockButton:
                  "bg-zinc-800/80 border-zinc-700 text-white hover:bg-zinc-700 transition-all rounded-xl",
                socialButtonsBlockButtonText: "text-white font-medium",
                dividerLine: "bg-zinc-700",
                dividerText: "text-zinc-500",
                formFieldLabel: "text-zinc-300 font-medium",
                formFieldInput:
                  "bg-zinc-800/80 border-zinc-700 text-white placeholder:text-zinc-500 rounded-xl focus:border-blue-500 focus:ring-blue-500/20",
                footerActionLink: "text-blue-400 hover:text-blue-300 font-medium",
                formButtonPrimary:
                  "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all",
                footer: "hidden",
              },
            }}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
          />

          <p className="mt-6 text-center text-sm text-zinc-500">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="text-blue-400 hover:text-blue-300 font-medium">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
