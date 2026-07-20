"use client";

import { useState, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { Upload, Loader2, Image as ImageIcon } from "lucide-react";

export function CustomAvatarUpload() {
  const { user, isLoaded } = useUser();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isLoaded || !user) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be smaller than 5MB.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      await user.setProfileImage({ file });
    } catch (err: any) {
      console.error("Failed to upload image:", err);
      setError(err.errors?.[0]?.message || "Failed to upload image. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          {user.hasImage ? (
            <img 
              src={user.imageUrl} 
              alt={user.fullName || "User avatar"} 
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-zinc-400" />
          )}
        </div>
        
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">
            Profile Picture
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Upload a custom avatar to personalize your profile.
          </p>
          
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
              disabled={isUploading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 transition-colors"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Image
                </>
              )}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
