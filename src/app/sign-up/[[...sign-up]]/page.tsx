import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { MapPin, Wifi, Zap, Volume2 } from "lucide-react";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-zinc-950 via-purple-950/20 to-zinc-950">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 bg-gradient-to-br from-purple-600/10 via-blue-600/10 to-cyan-600/10 border-r border-zinc-800">
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
            Join thousands of<br />
            <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
              remote workers
            </span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-md">
            Create an account to save your favorite workspaces and get personalized recommendations.
          </p>
          
          {/* Feature List */}
          <div className="space-y-3 max-w-md">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center">
                <Wifi className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-sm text-zinc-300">Find places with reliable WiFi</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="w-9 h-9 rounded-lg bg-yellow-600/20 flex items-center justify-center">
                <Zap className="w-4 h-4 text-yellow-400" />
              </div>
              <span className="text-sm text-zinc-300">Discover spots with power outlets</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
              <div className="w-9 h-9 rounded-lg bg-green-600/20 flex items-center justify-center">
                <Volume2 className="w-4 h-4 text-green-400" />
              </div>
              <span className="text-sm text-zinc-300">Filter by noise levels</span>
            </div>
          </div>
        </div>

        <p className="text-sm text-zinc-600">
          © 2024 WorkSphere. Built for remote workers everywhere.
        </p>
      </div>

      {/* Right Side - Sign Up Form */}
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

          <SignUp
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
                  "bg-zinc-800/80 border-zinc-700 text-white placeholder:text-zinc-500 rounded-xl focus:border-purple-500 focus:ring-purple-500/20",
                footerActionLink: "text-purple-400 hover:text-purple-300 font-medium",
                formButtonPrimary:
                  "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl shadow-lg shadow-purple-500/20 transition-all",
                footer: "hidden",
              },
            }}
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
          />

          <p className="mt-6 text-center text-sm text-zinc-500">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-purple-400 hover:text-purple-300 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
