"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RotateCw,
  X,
  Upload,
  Loader2,
  FileText,
  Sparkles,
  Maximize2,
} from "lucide-react";
import {
  compressImage,
  formatFileSize,
  getImageDimensions,
  ImageDimensions,
  CropArea,
} from "@/lib/media/imageCompressor";

export interface ImageUploadPayload {
  file: File;
  blob: Blob;
  dataUrl: string;
  caption: string;
  dimensions: ImageDimensions;
  sizeBytes: number;
}

export type AspectRatioOption = "original" | "square" | "16:9";

export interface ImageUploadPreviewModalProps {
  isOpen: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (payload: ImageUploadPayload) => void | Promise<void>;
  maxWidth?: number;
  maxHeight?: number;
}

export function ImageUploadPreviewModal({
  isOpen,
  file,
  onCancel,
  onConfirm,
  maxWidth = 1920,
  maxHeight = 1080,
}: ImageUploadPreviewModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>("original");
  const [caption, setCaption] = useState<string>("");
  const [dimensions, setDimensions] = useState<ImageDimensions>({
    width: 0,
    height: 0,
  });
  const [estimatedSize, setEstimatedSize] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Setup preview URL and extract initial dimensions
  useEffect(() => {
    if (!file || !isOpen) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl(null);
      setRotation(0);
      setAspectRatio("original");
      setCaption("");
      setDimensions({ width: 0, height: 0 });
      setEstimatedSize(0);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    previewUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
    setEstimatedSize(file.size);

    let isMounted = true;

    getImageDimensions(file)
      .then((dims) => {
        if (isMounted) {
          setDimensions(dims);
        }
      })
      .catch(() => {
        // Fallback default if image load fails
        if (isMounted) {
          setDimensions({ width: 800, height: 600 });
        }
      });

    return () => {
      isMounted = false;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [file, isOpen]);

  // Recalculate estimated compressed size and dimensions when rotation or crop changes
  useEffect(() => {
    if (!file || !isOpen) return;

    let isMounted = true;
    setIsProcessing(true);

    const timer = setTimeout(async () => {
      try {
        let cropArea: CropArea | null = null;
        if (dimensions.width > 0 && dimensions.height > 0) {
          if (aspectRatio === "square") {
            const side = Math.min(dimensions.width, dimensions.height);
            cropArea = {
              x: Math.floor((dimensions.width - side) / 2),
              y: Math.floor((dimensions.height - side) / 2),
              width: side,
              height: side,
            };
          } else if (aspectRatio === "16:9") {
            const targetHeight = Math.floor((dimensions.width * 9) / 16);
            if (targetHeight <= dimensions.height) {
              cropArea = {
                x: 0,
                y: Math.floor((dimensions.height - targetHeight) / 2),
                width: dimensions.width,
                height: targetHeight,
              };
            } else {
              const targetWidth = Math.floor((dimensions.height * 16) / 9);
              cropArea = {
                x: Math.floor((dimensions.width - targetWidth) / 2),
                y: 0,
                width: targetWidth,
                height: dimensions.height,
              };
            }
          }
        }

        const result = await compressImage(file, {
          maxWidth,
          maxHeight,
          rotation,
          crop: cropArea,
          quality: 0.82,
        });

        if (isMounted) {
          setEstimatedSize(result.sizeBytes);
        }
      } catch {
        // Fallback to file.size if client canvas compression is mock/restricted
        if (isMounted) {
          setEstimatedSize(file.size);
        }
      } finally {
        if (isMounted) {
          setIsProcessing(false);
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [file, isOpen, rotation, aspectRatio, dimensions, maxWidth, maxHeight]);

  // Rotate 90 degrees clockwise
  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  // Compute crop bounds helper
  const getCropArea = useCallback((): CropArea | null => {
    if (!dimensions.width || !dimensions.height) return null;
    if (aspectRatio === "square") {
      const side = Math.min(dimensions.width, dimensions.height);
      return {
        x: Math.floor((dimensions.width - side) / 2),
        y: Math.floor((dimensions.height - side) / 2),
        width: side,
        height: side,
      };
    }
    if (aspectRatio === "16:9") {
      const targetHeight = Math.floor((dimensions.width * 9) / 16);
      if (targetHeight <= dimensions.height) {
        return {
          x: 0,
          y: Math.floor((dimensions.height - targetHeight) / 2),
          width: dimensions.width,
          height: targetHeight,
        };
      }
      const targetWidth = Math.floor((dimensions.height * 16) / 9);
      return {
        x: Math.floor((dimensions.width - targetWidth) / 2),
        y: 0,
        width: targetWidth,
        height: dimensions.height,
      };
    }
    return null;
  }, [dimensions, aspectRatio]);

  // Confirm and upload workflow
  const handleConfirm = useCallback(async () => {
    if (!file || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const cropArea = getCropArea();
      const compressed = await compressImage(file, {
        maxWidth,
        maxHeight,
        rotation,
        crop: cropArea,
        quality: 0.82,
      });

      await onConfirm({
        file,
        blob: compressed.blob,
        dataUrl: compressed.dataUrl,
        caption: caption.trim(),
        dimensions: { width: compressed.width, height: compressed.height },
        sizeBytes: compressed.sizeBytes,
      });
    } catch (err) {
      console.error("Failed to compress image before upload:", err);
      // Fallback: send raw file
      await onConfirm({
        file,
        blob: file,
        dataUrl: previewUrl || "",
        caption: caption.trim(),
        dimensions,
        sizeBytes: file.size,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    file,
    isSubmitting,
    getCropArea,
    maxWidth,
    maxHeight,
    rotation,
    caption,
    onConfirm,
    previewUrl,
    dimensions,
  ]);

  // Keyboard accessibility: Escape to cancel, Enter to upload
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // If user is focused on the caption input, plain Enter uploads
        // If user is on an action button, native click handles it; otherwise Enter triggers upload
        if (!isSubmitting) {
          e.preventDefault();
          handleConfirm();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, handleConfirm, isSubmitting]);

  if (!isOpen || !file) return null;

  // Active display dimensions respecting crop and rotation
  let activeWidth = dimensions.width;
  let activeHeight = dimensions.height;

  if (dimensions.width > 0 && dimensions.height > 0) {
    if (aspectRatio === "square") {
      const side = Math.min(dimensions.width, dimensions.height);
      activeWidth = side;
      activeHeight = side;
    } else if (aspectRatio === "16:9") {
      const targetHeight = Math.floor((dimensions.width * 9) / 16);
      if (targetHeight <= dimensions.height) {
        activeHeight = targetHeight;
      } else {
        activeWidth = Math.floor((dimensions.height * 16) / 9);
      }
    }
  }

  const isRotatedSideways = rotation === 90 || rotation === 270;
  const displayWidth = isRotatedSideways ? activeHeight : activeWidth;
  const displayHeight = isRotatedSideways ? activeWidth : activeHeight;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-preview-modal-title"
      data-testid="image-upload-preview-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
          <div>
            <h2
              id="image-preview-modal-title"
              className="text-base font-bold text-zinc-100 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Image Upload Preview
            </h2>
            <p className="text-xs text-zinc-400 truncate max-w-sm">
              {file.name}
            </p>
          </div>
          <button
            type="button"
            data-testid="close-preview-modal-btn"
            onClick={onCancel}
            aria-label="Close modal"
            className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* High-res Image Preview Viewport */}
          <div className="relative w-full aspect-video bg-zinc-950 rounded-2xl border border-zinc-800/80 flex items-center justify-center overflow-hidden group">
            {previewUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewUrl}
                alt="Upload preview"
                data-testid="image-preview-thumbnail"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: "transform 0.25s ease-in-out",
                  maxHeight: "100%",
                  maxWidth: "100%",
                  objectFit: aspectRatio === "original" ? "contain" : "cover",
                }}
                className={`rounded-lg shadow-md ${
                  aspectRatio === "square"
                    ? "aspect-square"
                    : aspectRatio === "16:9"
                      ? "aspect-video"
                      : ""
                }`}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-xs">Loading preview…</span>
              </div>
            )}

            {/* Quick action overlay buttons on image */}
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                type="button"
                data-testid="rotate-image-btn"
                onClick={handleRotate}
                title="Rotate 90° clockwise"
                aria-label="Rotate image"
                className="px-3 py-1.5 bg-black/60 hover:bg-black/80 text-zinc-200 hover:text-white rounded-xl backdrop-blur-md border border-white/10 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shadow-md"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Rotate {rotation ? `(${rotation}°)` : ""}
              </button>
            </div>
          </div>

          {/* Metadata Badges Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60 text-xs text-zinc-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5 text-zinc-500" />
                Dimensions:{" "}
                <strong
                  data-testid="image-dimensions"
                  className="text-zinc-200 font-mono"
                >
                  {displayWidth || "—"} × {displayHeight || "—"} px
                </strong>
              </span>

              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-zinc-500" />
                Estimated Payload:{" "}
                <strong
                  data-testid="image-payload-size"
                  className="text-emerald-400 font-mono"
                >
                  {isProcessing
                    ? "Calculating…"
                    : formatFileSize(estimatedSize)}
                </strong>
              </span>
            </div>

            {/* Crop Aspect Ratio Selector */}
            <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
              <span className="text-[10px] uppercase font-bold text-zinc-500 px-1.5">
                Crop
              </span>
              {(["original", "square", "16:9"] as AspectRatioOption[]).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    data-testid={`crop-option-${option}`}
                    onClick={() => setAspectRatio(option)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition-colors ${
                      aspectRatio === option
                        ? "bg-zinc-700 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {option}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Caption Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="image-caption-input"
              className="text-xs font-semibold text-zinc-300 flex items-center justify-between"
            >
              <span>Add Caption</span>
              <span className="text-[10px] text-zinc-500">
                Press Enter to upload
              </span>
            </label>
            <input
              id="image-caption-input"
              ref={captionInputRef}
              type="text"
              data-testid="image-caption-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add context or notes for collaborative room nomads..."
              className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/80">
          <span className="text-[11px] text-zinc-500">
            Esc to cancel • Enter to upload
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="cancel-preview-btn"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              data-testid="confirm-upload-btn"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg shadow-emerald-900/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compressing…</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Upload</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
