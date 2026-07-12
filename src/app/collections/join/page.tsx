"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import Link from "next/link";

function JoinContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const router = useRouter();
  
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Joining collection...");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No invite token provided.");
      return;
    }

    const joinFolder = async () => {
      try {
        const res = await fetch("/api/folders/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          setMessage("Successfully joined the collection!");
          setTimeout(() => {
            router.push(`/collections/${data.folderId}`);
          }, 1500);
        } else {
          setStatus("error");
          setMessage(data.error || "Failed to join collection.");
        }
      } catch (e) {
        setStatus("error");
        setMessage("An unexpected error occurred.");
      }
    };

    joinFolder();
  }, [token, router]);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 max-w-md w-full text-center shadow-xl">
      <Users className="w-12 h-12 text-blue-500 mx-auto mb-4" />
      <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">Joining Collection</h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6">{message}</p>
      
      {status === "loading" && (
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
      )}
      
      {status === "error" && (
        <Link href="/collections" className="inline-block px-6 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white font-medium rounded-xl transition-colors">
          Go to My Collections
        </Link>
      )}
    </div>
  );
}

export default function JoinFolderPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
       <Suspense fallback={<Loader2 className="w-8 h-8 animate-spin text-zinc-400" />}>
         <JoinContent />
       </Suspense>
    </div>
  );
}
