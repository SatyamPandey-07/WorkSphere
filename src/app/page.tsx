import Link from "next/link";
import { MapPin, Wifi, Zap, Volume2, Clock, Sparkles } from "lucide-react";
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-zinc-50 dark:from-black dark:to-zinc-950">
      {/* Navigation */}
      <nav className="container mx-auto px-4 py-6 flex items-center justify-between">
        <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          WorkHub
        </div>
        <div className="flex items-center gap-4">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 font-medium transition-colors">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                Sign Up
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/ai"
              className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 font-medium transition-colors"
            >
              Dashboard
            </Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto mb-16">
          <div className="mb-6">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm font-medium mb-8">
              <Sparkles className="w-4 h-4" />
              AI-Powered Workspace Discovery
            </span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold text-zinc-900 dark:text-zinc-50 mb-6 tracking-tight">
            Find Your Perfect
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Work Space
            </span>
          </h1>
          
          <p className="text-xl text-zinc-600 dark:text-zinc-400 mb-8 max-w-2xl mx-auto">
            Discover cafes, coworking spaces, and libraries with great WiFi, power outlets, 
            and the perfect atmosphere for your work style.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <SignedOut>
              <SignUpButton mode="modal">
                <button className="px-8 py-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl">
                  Get Started Free 🎯
                </button>
              </SignUpButton>
              <a
                href="#features"
                className="px-8 py-4 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                Learn More
              </a>
            </SignedOut>
            <SignedIn>
              <Link
                href="/ai"
                className="px-8 py-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
              >
                Find Your Spot 🎯
              </Link>
              <a
                href="#features"
                className="px-8 py-4 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                Learn More
              </a>
            </SignedIn>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
          <FeatureCard
            icon={<Wifi className="w-6 h-6" />}
            title="WiFi Quality"
            description="Find spaces with reliable, fast internet perfect for video calls and heavy uploads."
            color="blue"
          />
          <FeatureCard
            icon={<Volume2 className="w-6 h-6" />}
            title="Noise Levels"
            description="Filter by quiet zones for focus work or moderate noise for casual work sessions."
            color="green"
          />
          <FeatureCard
            icon={<Zap className="w-6 h-6" />}
            title="Power Outlets"
            description="Never run out of battery. Find venues with plenty of accessible power outlets."
            color="yellow"
          />
          <FeatureCard
            icon={<Clock className="w-6 h-6" />}
            title="Busy Times"
            description="Avoid crowds with insights on peak hours and best times to visit."
            color="purple"
          />
          <FeatureCard
            icon={<MapPin className="w-6 h-6" />}
            title="Smart Routing"
            description="Get directions to your chosen workspace with estimated walking times."
            color="red"
          />
          <FeatureCard
            icon={<Sparkles className="w-6 h-6" />}
            title="AI-Powered"
            description="Multi-agent AI understands your needs and finds the perfect match every time."
            color="indigo"
          />
        </div>

        {/* How It Works */}
        <div className="max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold text-center text-zinc-900 dark:text-zinc-50 mb-12">
            How It Works
          </h2>
          
          <div className="space-y-8">
            <Step
              number={1}
              title="Tell us what you need"
              description="Just describe your ideal workspace in natural language: 'Find a quiet cafe with outlets near me'"
            />
            <Step
              number={2}
              title="AI finds the best matches"
              description="Our multi-agent system searches, scores, and ranks venues based on WiFi, noise, outlets, and more"
            />
            <Step
              number={3}
              title="Explore on the map"
              description="See all options on an interactive map with details, ratings, and directions"
            />
            <Step
              number={4}
              title="Share your experience"
              description="Help the community by rating venues you visit"
            />
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-12 text-white">
          <h2 className="text-3xl font-bold mb-4">
            Ready to Find Your Perfect Workspace?
          </h2>
          <p className="text-xl mb-8 text-blue-100">
            Join thousands of remote workers finding their ideal work spots
          </p>
          <Link
            href="/ai"
            className="inline-block px-8 py-4 rounded-lg bg-white text-blue-600 font-semibold hover:bg-zinc-100 transition-colors shadow-lg"
          >
            Get Started Free
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-8 mt-16">
        <div className="container mx-auto px-4 text-center text-zinc-600 dark:text-zinc-400">
          <p>Built with Next.js, AI SDK, and ❤️ for remote workers</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: "bg-blue-100 dark:bg-blue-900/20 text-blue-600",
    green: "bg-green-100 dark:bg-green-900/20 text-green-600",
    yellow: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600",
    purple: "bg-purple-100 dark:bg-purple-900/20 text-purple-600",
    red: "bg-red-100 dark:bg-red-900/20 text-red-600",
    indigo: "bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600",
  };

  return (
    <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-lg transition-shadow">
      <div className={`inline-flex p-3 rounded-lg mb-4 ${colorClasses[color]}`}>
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
        {title}
      </h3>
      <p className="text-zinc-600 dark:text-zinc-400">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
          {title}
        </h3>
        <p className="text-zinc-600 dark:text-zinc-400">{description}</p>
      </div>
    </div>
  );
}
