"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  CheckCircle2,
  Loader2,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { normalizeImageOrientation } from "@/lib/exifOrientation";
import { AvatarCropModal } from "@/components/AvatarCropModal";
import { dispatchAvatarUpdated } from "@/lib/avatar-events";
import { MemberSinceBadge } from "@/components/MemberSinceBadge";

const MAX_SOURCE_FILE_SIZE = 5 * 1024 * 1024;
const HEIC_EXTENSIONS = [".heic", ".heif"];
const MIN_IMAGE_DIMENSION = 100;

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

function getImageDimensions(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to read image dimensions."));
    img.src = src;
  });
}

export const AVATAR_PALETTE_COLORS = [
  {
    id: "indigo",
    name: "Indigo",
    bgClass: "bg-indigo-500",
    colorCode: "#6366f1",
  },
  {
    id: "teal",
    name: "Teal",
    bgClass: "bg-teal-500",
    colorCode: "#14b8a6",
  },
  {
    id: "rose",
    name: "Rose",
    bgClass: "bg-rose-500",
    colorCode: "#f43f5e",
  },
  {
    id: "amber",
    name: "Amber",
    bgClass: "bg-amber-500",
    colorCode: "#f59e0b",
  },
  {
    id: "violet",
    name: "Violet",
    bgClass: "bg-violet-500",
    colorCode: "#8b5cf6",
  },
  {
    id: "emerald",
    name: "Emerald",
    bgClass: "bg-emerald-500",
    colorCode: "#10b981",
  },
  {
    id: "sky",
    name: "Sky",
    bgClass: "bg-sky-500",
    colorCode: "#0ea5e9",
  },
  {
    id: "fuchsia",
    name: "Fuchsia",
    bgClass: "bg-fuchsia-500",
    colorCode: "#d946ef",
  },
] as const;

export type AvatarPaletteColor = (typeof AVATAR_PALETTE_COLORS)[number]["id"];

export interface CustomAvatarUploadProps {
  initialColor?: AvatarPaletteColor;
  onColorChange?: (color: AvatarPaletteColor) => void;
  hasCustomPhoto?: boolean;
}

export function getAvatarInitials(
  user: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  } | null,
): string {
  if (!user) return "WS";
  if (user.firstName || user.lastName) {
    const first = user.firstName?.[0] || "";
    const last = user.lastName?.[0] || "";
    const combined = `${first}${last}`.trim().toUpperCase();
    if (combined) return combined;
  }
  if (user.fullName) {
    const parts = user.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }
  return "WS";
}

export function CustomAvatarUpload({
  initialColor,
  onColorChange,
  hasCustomPhoto,
}: CustomAvatarUploadProps = {}) {
  const { user, isLoaded } = useUser();
  const [isPreparing, setIsPreparing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedColor, setSelectedColor] = useState<AvatarPaletteColor>(() => {
    if (
      initialColor &&
      AVATAR_PALETTE_COLORS.some((c) => c.id === initialColor)
    ) {
      return initialColor as AvatarPaletteColor;
    }
    const metaColor = (user?.unsafeMetadata as Record<string, any> | undefined)
      ?.avatarColor;
    if (metaColor && AVATAR_PALETTE_COLORS.some((c) => c.id === metaColor)) {
      return metaColor as AvatarPaletteColor;
    }
    if (typeof window !== "undefined") {
      try {
        const stored =
          (user?.id &&
            localStorage.getItem(`worksphere_avatar_color_${user.id}`)) ||
          localStorage.getItem("worksphere_avatar_color");
        if (stored && AVATAR_PALETTE_COLORS.some((c) => c.id === stored)) {
          return stored as AvatarPaletteColor;
        }
      } catch {}
    }
    return "indigo";
  });

  useEffect(() => {
    if (
      initialColor &&
      AVATAR_PALETTE_COLORS.some((c) => c.id === initialColor)
    ) {
      setSelectedColor(initialColor as AvatarPaletteColor);
      return;
    }
    const metaColor = (user?.unsafeMetadata as Record<string, any> | undefined)
      ?.avatarColor;
    if (metaColor && AVATAR_PALETTE_COLORS.some((c) => c.id === metaColor)) {
      setSelectedColor(metaColor as AvatarPaletteColor);
    }
  }, [initialColor, user?.unsafeMetadata]);

  const handleColorSelect = async (colorId: AvatarPaletteColor) => {
    setSelectedColor(colorId);
    setSuccess("Avatar color updated.");

    // Persist to localStorage
    if (typeof window !== "undefined") {
      try {
        if (user?.id) {
          localStorage.setItem(`worksphere_avatar_color_${user.id}`, colorId);
        }
        localStorage.setItem("worksphere_avatar_color", colorId);
      } catch (e) {
        console.warn("Failed to persist avatar color to localStorage:", e);
      }
    }

    // Persist to Clerk user unsafeMetadata
    if (user && typeof (user as any).update === "function") {
      try {
        await (user as any).update({
          unsafeMetadata: {
            ...((user.unsafeMetadata as Record<string, any>) || {}),
            avatarColor: colorId,
          },
        });
      } catch (err) {
        console.warn(
          "Failed to persist avatar color in Clerk unsafeMetadata:",
          err,
        );
      }
    }

    // Persist via user settings API endpoint if supported
    try {
      if (typeof window !== "undefined" && typeof window.fetch === "function") {
        fetch("/api/user/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarColor: colorId }),
        }).catch(() => {});
      }
    } catch {}

    onColorChange?.(colorId);
  };

  const objectUrls = useRef<Set<string>>(new Set());

  const createSafeObjectURL = (file: File | Blob) => {
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    return url;
  };

  const revokeSafeObjectURL = (url: string) => {
    if (objectUrls.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
    }
  };

  useEffect(() => {
    const urlsToRevoke = objectUrls.current;
    return () => {
      urlsToRevoke.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      urlsToRevoke.clear();
    };
  }, []);

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

    setPreviewUrl((currentPreview) => {
      if (currentPreview) {
        revokeSafeObjectURL(currentPreview);
      }
      return null;
    });
    setCropSource((currentSource) => {
      if (currentSource) {
        revokeSafeObjectURL(currentSource);
      }
      return null;
    });
    setSelectedFileName("");
  };

  const handleRemovePreview = () => {
    setPreviewUrl((currentPreview) => {
      if (currentPreview) {
        revokeSafeObjectURL(currentPreview);
      }
      return null;
    });
    setCropSource((currentSource) => {
      if (currentSource) {
        revokeSafeObjectURL(currentSource);
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

      const source = createSafeObjectURL(file);

      let dimensions: { width: number; height: number };
      try {
        dimensions = await getImageDimensions(source);
      } catch {
        revokeSafeObjectURL(source);
        setError("Failed to read image dimensions. Please try another file.");
        clearInput();
        return;
      }

      if (
        dimensions.width < MIN_IMAGE_DIMENSION ||
        dimensions.height < MIN_IMAGE_DIMENSION
      ) {
        revokeSafeObjectURL(source);
        setError(
          `Image resolution too low. Minimum ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION} required.`,
        );
        clearInput();
        return;
      }

      setPreviewUrl((currentPreview) => {
        if (currentPreview) {
          revokeSafeObjectURL(currentPreview);
        }

        return source;
      });

      setCropSource((currentSource) => {
        if (currentSource) {
          revokeSafeObjectURL(currentSource);
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

    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 500;

    try {
      if (!user) return;
      const normalizedFile = await normalizeImageOrientation(croppedFile);
      const objectUrl = createSafeObjectURL(normalizedFile);

      setPreviewUrl((currentPreview) => {
        if (currentPreview) {
          revokeSafeObjectURL(currentPreview);
        }
        return objectUrl;
      });

      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await user.setProfileImage({ file: normalizedFile });
          await user.reload();
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_ATTEMPTS) {
            // Exponential backoff: 500ms, 1000ms
            await new Promise((resolve) =>
              setTimeout(resolve, BASE_DELAY_MS * 2 ** (attempt - 1)),
            );
          }
        }
      }

      if (lastError) throw lastError;

      dispatchAvatarUpdated(user.id, user.imageUrl);
      setSuccess("Profile picture updated.");

      setCropSource((currentSource) => {
        if (currentSource) {
          revokeSafeObjectURL(currentSource);
        }
        return null;
      });
      setSelectedFileName("");
      clearInput();
    } catch (uploadError: unknown) {
      console.error("Failed to upload image after retries:", uploadError);

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

  const hasPhoto =
    hasCustomPhoto !== undefined ? hasCustomPhoto : Boolean(user?.hasImage);
  const activeAvatarUrl = previewUrl || (hasPhoto ? user?.imageUrl : null);
  const initials = getAvatarInitials(user);
  const activeColorConfig =
    AVATAR_PALETTE_COLORS.find((c) => c.id === selectedColor) ||
    AVATAR_PALETTE_COLORS[0];

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div
            data-testid="avatar-display"
            className={`w-16 h-16 rounded-full overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center ${
              activeAvatarUrl
                ? "bg-zinc-100 dark:bg-zinc-800"
                : activeColorConfig.bgClass
            }`}
            style={
              !activeAvatarUrl
                ? { backgroundColor: activeColorConfig.colorCode }
                : undefined
            }
          >
            {activeAvatarUrl ? (
              <Image
                src={activeAvatarUrl}
                alt={user?.fullName || "User avatar"}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                style={{ imageOrientation: "from-image" }}
                unoptimized
              />
            ) : (
              <div
                data-testid="initials-avatar"
                className={`w-full h-full flex items-center justify-center font-bold text-white text-lg select-none tracking-wider ${activeColorConfig.bgClass}`}
                style={{ backgroundColor: activeColorConfig.colorCode }}
              >
                {initials}
              </div>
            )}
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">
              Profile Picture
            </h3>
            <MemberSinceBadge createdAt={user?.createdAt} className="mb-2" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Upload a custom avatar to personalize your profile. (Max 5MB)
            </p>

            <div className="flex items-center gap-4">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="file-input"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isUploading || isPreparing}
              />
              {previewUrl ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isPreparing}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={handleRemovePreview}
                    disabled={isUploading || isPreparing}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isPreparing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 transition-colors"
                >
                  {isUploading || isPreparing ? (
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
              )}
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

        {/* 8 Preset Color Swatches for Default Initials Avatar */}
        <div
          className="mt-6 pt-5 border-t border-zinc-200 dark:border-zinc-800"
          data-testid="avatar-color-palette"
        >
          <div className="mb-3">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">
              Avatar Initials Color
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Choose from 8 preset background colors for your initials avatar.
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-2.5"
            role="radiogroup"
            aria-label="Avatar background color palette"
          >
            {AVATAR_PALETTE_COLORS.map((color) => {
              const isSelected = selectedColor === color.id;
              return (
                <button
                  key={color.id}
                  type="button"
                  role="button"
                  data-testid={`color-swatch-${color.id}`}
                  data-color={color.id}
                  aria-label={color.name}
                  aria-pressed={isSelected}
                  title={color.name}
                  onClick={() => handleColorSelect(color.id)}
                  className={`w-8 h-8 rounded-full ${color.bgClass} transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 dark:focus:ring-white flex items-center justify-center relative ${
                    isSelected
                      ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-white scale-110 shadow-sm"
                      : "opacity-85 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: color.colorCode }}
                >
                  {isSelected && (
                    <span
                      data-testid="selected-swatch-indicator"
                      className="w-2.5 h-2.5 rounded-full bg-white shadow-xs"
                    />
                  )}
                </button>
              );
            })}
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
    </div>
  );
}
