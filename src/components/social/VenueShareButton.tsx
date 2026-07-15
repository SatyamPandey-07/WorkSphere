"use client";

import { Share2 } from "lucide-react";
import { useState } from "react";

type Props = {
  venueId: string;
  venueName: string;
};

export function VenueShareButton({ venueId, venueName }: Props) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/social?venue=${encodeURIComponent(venueId)}`;
    const data = {
      title: `${venueName} on WorkSphere`,
      text: `Check out ${venueName} as a place to work.`,
      url,
    };

    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }

      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Unable to share venue", error);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
    >
      <Share2 className="h-4 w-4" />
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
