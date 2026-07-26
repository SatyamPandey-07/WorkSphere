"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyToClipboardButtonProps {
  textToCopy: string;
  className?: string;
  label?: string;
}

export function CopyToClipboardButton({ 
  textToCopy, 
  className = "", 
  label = "Copy Address" 
}: CopyToClipboardButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Requirement 4: Fallback for legacy browsers without navigator.clipboard
  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // Avoid scrolling to bottom on mobile
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand("copy");
    } catch (err) {
      console.error("Fallback: Oops, unable to copy", err);
    }

    document.body.removeChild(textArea);
  };

  // Requirement 2: Write text using navigator.clipboard
  const handleCopy = async () => {
    if (!navigator.clipboard) {
      fallbackCopyTextToClipboard(textToCopy);
      triggerFeedback();
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      triggerFeedback();
    } catch (err) {
      console.error("Failed to copy text: ", err);
      // Try fallback if modern API fails for any reason
      fallbackCopyTextToClipboard(textToCopy);
      triggerFeedback();
    }
  };

  // Requirement 3: Display temporary checkmark and trigger toast feedback
  const triggerFeedback = () => {
    setIsCopied(true);
    setShowToast(true);
    
    // Reset back to normal after 2.5 seconds
    setTimeout(() => {
      setIsCopied(false);
      setShowToast(false);
    }, 2500);
  };

  return (
    <>
      <button
        onClick={handleCopy}
        type="button"
        title="Copy to clipboard"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          isCopied 
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        } ${className}`}
      >
        {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        <span>{isCopied ? "Copied!" : label}</span>
      </button>

      {/* Self-contained Toast Notification */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-black rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-5 duration-300">
          <Check className="w-4 h-4 text-green-400 dark:text-green-600" />
          Address copied to clipboard
        </div>
      )}
    </>
  );
}
