"use client";

import React, { useState } from "react";
import { Send } from "lucide-react";

interface VenueReviewFormProps {
  venueId?: string;
  onSubmit?: (review: string) => void;
}

export function VenueReviewForm({ venueId, onSubmit }: VenueReviewFormProps) {
  const [reviewText, setReviewText] = useState("");
  const MAX_CHARS = 500;

  const currentLength = reviewText.length;
  
  // Logic Requirements 3 & 4: Check if empty or exceeded
  const isExceeded = currentLength > MAX_CHARS;
  const isEmpty = currentLength === 0;
  const isDisabled = isEmpty || isExceeded;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;
    
    if (onSubmit) {
      onSubmit(reviewText);
    } else {
      console.log("Submitting review for venue:", venueId, "Review:", reviewText);
    }
    
    // Clear the form after successful submission
    setReviewText("");
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-2">
      <div className="relative">
        {/* Text Area */}
        <textarea
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="Share your experience at this venue..."
          className={`w-full min-h-[120px] p-4 text-sm rounded-xl border bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 transition-colors resize-y ${
            isExceeded
              ? "border-red-500 focus:ring-red-500/20 text-red-900 dark:text-red-400"
              : "border-zinc-200 dark:border-zinc-800 focus:ring-blue-500/20 focus:border-blue-500"
          }`}
          aria-invalid={isExceeded}
        />
        
        <div className="flex justify-between items-start mt-2">
          {/* Requirement 2 & 3: Character Counter Badge & Warning Text */}
          <div 
            className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
              isExceeded 
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" 
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {currentLength}/{MAX_CHARS} characters
            {isExceeded && (
              <span className="ml-1.5 font-bold">
                (Too long!)
              </span>
            )}
          </div>
          
          {/* Requirement 4: Disable Submit Button */}
          <button
            type="submit"
            disabled={isDisabled}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              isDisabled
                ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed opacity-70"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95"
            }`}
          >
            <Send className="w-4 h-4" />
            Submit Review
          </button>
        </div>
      </div>
    </form>
  );
}
