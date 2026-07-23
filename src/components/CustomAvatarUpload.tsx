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

  const handleCroppedUpload = async (croppedFile: File) => {
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

  const isBusy = isPreparing || isUploading;

  return (
    <>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800">
            {user.hasImage ? (
              <Image
                src={user.imageUrl}
                alt={user.fullName || "User avatar"}
                width={64}
                height={64}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <ImageIcon className="h-6 w-6 text-zinc-400" aria-hidden="true" />
            )}
          </div>

          <div className="flex-1">
            <h3 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-white">
              Profile Picture
            </h3>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
              Choose an image, adjust the square crop, and upload a polished
              avatar.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isBusy}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                {isBusy ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    {isPreparing ? "Preparing..." : "Uploading..."}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Choose Image
                  </>
                )}
              </button>

              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                JPEG, PNG, WebP, HEIC · max 5MB
              </span>
            </div>

            {error && (
              <p
                className="mt-3 text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {error}
              </p>
            )}

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
