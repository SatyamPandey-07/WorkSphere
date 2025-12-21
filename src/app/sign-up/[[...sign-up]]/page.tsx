import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
      <div className="w-full max-w-md p-4">
        <SignUp
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-zinc-900 border border-zinc-800 shadow-xl",
              headerTitle: "text-white",
              headerSubtitle: "text-zinc-400",
              socialButtonsBlockButton:
                "bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700",
              socialButtonsBlockButtonText: "text-white",
              dividerLine: "bg-zinc-700",
              dividerText: "text-zinc-500",
              formFieldLabel: "text-zinc-300",
              formFieldInput:
                "bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500",
              footerActionLink: "text-blue-400 hover:text-blue-300",
              formButtonPrimary:
                "bg-blue-600 hover:bg-blue-500 text-white",
            },
          }}
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
        />
      </div>
    </div>
  );
}
