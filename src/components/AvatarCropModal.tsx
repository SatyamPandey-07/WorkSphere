"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Crop, Loader2, Minus, Plus, X } from "lucide-react";

import {
  AVATAR_OUTPUT_SIZE,
  createCroppedAvatarFile,
  cropImageToWebP,
  type PixelCrop,
} from "@/lib/avatar-crop";

type AvatarCropModalProps = {
  imageSource: string;
  originalFileName: string;
  isOpen: boolean;
  isProcessing?: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void> | void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

export function AvatarCropModal({
  imageSource,
  originalFileName,
  isOpen,
  isProcessing = false,
  onCancel,
  onConfirm,
}: AvatarCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<PixelCrop | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedPixels(null);
    setCropError(null);
  }, [imageSource, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isProcessing) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, onCancel]);

  const handleCropComplete = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedPixels({
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y,
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
      });
    },
    [],
  );

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)));
  };

  const handleConfirm = async () => {
    if (!croppedPixels || isProcessing) {
      return;
    }

    setCropError(null);

    try {
      const blob = await cropImageToWebP(
        imageSource,
        croppedPixels,
        AVATAR_OUTPUT_SIZE,
      );

      const file = createCroppedAvatarFile(blob, originalFileName);
      await onConfirm(file);
    } catch (error) {
      setCropError(
        error instanceof Error
          ? error.message
          : "Unable to crop the selected image.",
      );
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isProcessing) {
          onCancel();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        aria-describedby="avatar-crop-description"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2
              id="avatar-crop-title"
              className="flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-white"
            >
              <Crop className="h-5 w-5" aria-hidden="true" />
              Crop profile picture
            </h2>
            <p
              id="avatar-crop-description"
              className="mt-1 text-sm text-zinc-500 dark:text-zinc-400"
            >
              Drag the image and use zoom to choose a square avatar.
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            aria-label="Close image crop dialog"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="p-5">
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-950">
            <Cropper
              image={imageSource}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid
              objectFit="contain"
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="avatar-crop-zoom"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Zoom
              </label>
              <span className="text-xs tabular-nums text-zinc-500">
                {zoom.toFixed(1)}×
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => changeZoom(zoom - ZOOM_STEP)}
                disabled={isProcessing || zoom <= MIN_ZOOM}
                className="rounded-lg border border-zinc-200 p-2 text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>

              <input
                id="avatar-crop-zoom"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={zoom}
                disabled={isProcessing}
                onChange={(event) => changeZoom(Number(event.target.value))}
                className="h-2 flex-1 cursor-pointer accent-zinc-900 disabled:cursor-not-allowed dark:accent-white"
              />

              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => changeZoom(zoom + ZOOM_STEP)}
                disabled={isProcessing || zoom >= MAX_ZOOM}
                className="rounded-lg border border-zinc-200 p-2 text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              The final image is compressed to WebP and exported at a maximum
              size of {AVATAR_OUTPUT_SIZE}×{AVATAR_OUTPUT_SIZE} pixels.
            </p>

            {cropError && (
              <p
                className="mt-3 text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {cropError}
              </p>
            )}
          </div>
        </div>

        <footer className="flex justify-end gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!croppedPixels || isProcessing}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Uploading...
              </>
            ) : (
              <>
                <Crop className="h-4 w-4" aria-hidden="true" />
                Crop and upload
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
