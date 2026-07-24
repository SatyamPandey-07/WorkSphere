"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { notifyAvatarUpdated } from "@/lib/avatar-events";
import { normalizeImageOrientation } from "@/lib/exifOrientation";

import { AvatarCropModal } from "@/components/AvatarCropModal";
import { dispatchAvatarUpdated } from "@/lib/avatar-events";

const MAX_SOURCE_FILE_SIZE = 5 * 1024 * 1024;
const HEIC_EXTENSIONS = [".heic", ".heif"];

const isHeicFile = (file: File) =>
  HEIC_EXTENSIONS.some((extension) =>
    file.name.toLowerCase().endsWith(extension),
  ) ||
  file.type === "image/heic" ||
  file.type === "image/heif";

async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const convertedResult = await heic2any({
    blob: file,
    toType: "image/jpeg",
  });
  const convertedBlob =
    convertedResult instanceof Blob ? convertedResult : convertedResult[0];

  return new File(
    [convertedBlob],
    file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"),
    {
      type: "image/jpeg",
      lastModified: Date.now(),
    },
  );
}

export function CustomAvatarUpload() {
  const { user, isLoaded } = useUser();
  const [isPreparing, setIsPreparing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (cropSource) {
        URL.revokeObjectURL(cropSource);
      }
    };
  }, [cropSource]);

  if (!isLoaded || !user) {
    return null;
  }

  const clearInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const closeCropModal = () => {
    if (isUploading) {
      return;
    }

    setCropSource((currentSource) => {
      if (currentSource) {
        URL.revokeObjectURL(currentSource);
      }

      return null;
    });
    setSelectedFileName("");
    clearInput();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    let file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setError(null);
    setSuccess(null);

    if (file.size > MAX_SOURCE_FILE_SIZE) {
      setError("Image must be smaller than 5MB.");
      clearInput();
      return;
    }

    setIsPreparing(true);

    try {
      if (isHeicFile(file)) {
        file = await convertHeicToJpeg(file);
      }

      if (!file.type.startsWith("image/")) {
        setError("Please select an image file.");
        clearInput();
        return;
      }

      const source = URL.createObjectURL(file);

      setCropSource((currentSource) => {
        if (currentSource) {
          URL.revokeObjectURL(currentSource);
        }

        return source;
      });
      setSelectedFileName(file.name);
    } catch {
      setError(
        "HEIC/HEIF format could not be converted. Please use JPEG, PNG, or WebP.",
      );
      clearInput();
    } finally {
      setIsPreparing(false);
    }
  };

    // Parse EXIF orientation tags and normalize image canvas matrix if needed
    file = await normalizeImageOrientation(file);

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    setError(null);
    setSuccess(null);
    setIsUploading(true);

    try {
      await user.setProfileImage({
        file: croppedFile,
      });
      await user.reload();

      dispatchAvatarUpdated(user.id, user.imageUrl);
      setSuccess("Profile picture updated.");

      setCropSource((currentSource) => {
        if (currentSource) {
          URL.revokeObjectURL(currentSource);
        }

        return null;
      });
      setSelectedFileName("");
      clearInput();
    } catch (uploadError: unknown) {
      console.error("Failed to upload image:", uploadError);

      const clerkError = uploadError as {
        errors?: Array<{ message?: string }>;
      };

      setError(
        clerkError.errors?.[0]?.message ??
          "Failed to upload image. Please try again.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const activeAvatarUrl = previewUrl || (user.hasImage ? user.imageUrl : null);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          {activeAvatarUrl ? (
            <Image
              src={activeAvatarUrl}
              alt={user.fullName || "User avatar"}
              width={64}
              height={64}
              className="w-full h-full object-cover"
              style={{ imageOrientation: "from-image" }}
              unoptimized
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
              data-testid="file-input"
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
            {success && (
              <p
                className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"
                role="status"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {success}
              </p>
            )}
          </div>
        </div>
      </div>

      <AvatarCropModal
        imageSource={cropSource ?? ""}
        originalFileName={selectedFileName}
        isOpen={Boolean(cropSource)}
        isProcessing={isUploading}
        onCancel={closeCropModal}
        onConfirm={handleCroppedUpload}
      />
    </>
  );
}
