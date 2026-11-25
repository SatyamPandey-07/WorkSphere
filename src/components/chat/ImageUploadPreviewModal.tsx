"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  RotateCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Upload,
} from "lucide-react";
import { useModalKeyboardNavigation } from "@/hooks/useModalKeyboardNavigation";

export interface ProcessedImagePayload {
  file: File | Blob;
  width: number;
  height: number;
  rotation: number;
  zoom: number;
}

export interface ImageUploadPreviewModalProps {
  isOpen: boolean;
  imageFile?: File | Blob | null;
  imageUrl?: string | null;
  onClose: () => void;
  onConfirm: (payload: ProcessedImagePayload) => void | Promise<void>;
  title?: string;
}

/**
 * Calculates rotated canvas and container dimensions.
 * For 90° and 270° angles, width and height are swapped to preserve aspect ratio.
 */
export function calculateRotatedDimensions(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number; isSwapped: boolean } {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0, isSwapped: false };
  }
  const normalized = ((rotation % 360) + 360) % 360;
  const isSwapped = normalized === 90 || normalized === 270;
  return {
    width: isSwapped ? height : width,
    height: isSwapped ? width : height,
    isSwapped,
  };
}

export function ImageUploadPreviewModal({
  isOpen,
  imageFile,
  imageUrl: externalImageUrl,
  onClose,
  onConfirm,
  title = "Review & Upload Image",
}: ImageUploadPreviewModalProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load preview source from file or URL
  useEffect(() => {
    if (!isOpen) return;

    setRotation(0);
    setZoom(1);

    if (imageFile) {
      const objectUrl = URL.createObjectURL(imageFile);
      setPreviewSrc(objectUrl);
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    } else if (externalImageUrl) {
      setPreviewSrc(externalImageUrl);
    } else {
      setPreviewSrc(null);
    }
  }, [isOpen, imageFile, externalImageUrl]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setDimensions({ width: naturalWidth, height: naturalHeight });
  };

  // Re-draw canvas when image loads, dimensions change, or rotation updates
  useEffect(() => {
    if (!previewSrc || !dimensions.width || !dimensions.height) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width: targetWidth, height: targetHeight } =
      calculateRotatedDimensions(dimensions.width, dimensions.height, rotation);

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.save();
    ctx.translate(targetWidth / 2, targetHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);

    if (imgRef.current) {
      ctx.drawImage(
        imgRef.current,
        -dimensions.width / 2,
        -dimensions.height / 2,
        dimensions.width,
        dimensions.height
      );
    }
    ctx.restore();
  }, [previewSrc, dimensions, rotation]);

  const handleRotateCw = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleRotateCcw = useCallback(() => {
    setRotation((prev) => (prev + 270) % 360);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(3, Math.round((prev + 0.25) * 100) / 100));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.5, Math.round((prev - 0.25) * 100) / 100));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting || !previewSrc) return;
    setIsSubmitting(true);

    try {
      const { width: targetWidth, height: targetHeight } = calculateRotatedDimensions(
        dimensions.width || 800,
        dimensions.height || 600,
        rotation
      );

      // Render to canvas to bake in rotation and dimensions
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        ctx = null;
      }

      if (ctx && imgRef.current) {
        ctx.translate(targetWidth / 2, targetHeight / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(
          imgRef.current,
          -dimensions.width / 2,
          -dimensions.height / 2,
          dimensions.width,
          dimensions.height
        );
      }

      const blob = await new Promise<Blob>((resolve) => {
        if (typeof canvas.toBlob === "function") {
          try {
            canvas.toBlob(
              (b) => resolve(b || (imageFile as Blob) || new Blob()),
              (imageFile as File)?.type || "image/jpeg",
              0.9
            );
            return;
          } catch {
            // fallback
          }
        }
        resolve((imageFile as Blob) || new Blob());
      });

      const fileName =
        imageFile instanceof File ? imageFile.name : "uploaded-image.jpg";
      const exportedFile = new File([blob], fileName, {
        type: blob.type || "image/jpeg",
      });

      await onConfirm({
        file: exportedFile,
        width: targetWidth,
        height: targetHeight,
        rotation,
        zoom,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    previewSrc,
    dimensions,
    rotation,
    zoom,
    imageFile,
    onConfirm,
  ]);

  // Hook up full accessibility focus trap & keyboard shortcuts
  useModalKeyboardNavigation({
    isOpen,
    containerRef: modalRef,
    onClose,
    onConfirm: handleConfirm,
    onRotateClockwise: handleRotateCw,
    onRotateCounterClockwise: handleRotateCcw,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onResetZoom: handleResetZoom,
  });

  if (!isOpen) return null;

  const { width: targetWidth, height: targetHeight, isSwapped } =
    calculateRotatedDimensions(dimensions.width, dimensions.height, rotation);

  const aspectRatio =
    targetWidth && targetHeight ? `${targetWidth} / ${targetHeight}` : "auto";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-preview-modal-title"
      ref={modalRef}
      data-testid="image-upload-preview-modal"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2
            id="image-preview-modal-title"
            className="text-base font-semibold text-white"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label="Close modal (Esc)"
            title="Cancel & close (Esc)"
            data-testid="modal-close-button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar with Tooltip Hints */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 bg-zinc-950/50 px-5 py-2.5 text-xs text-zinc-300">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRotateCcw}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 font-medium transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title="Rotate counter-clockwise (Shift + R)"
              aria-label="Rotate counter-clockwise (Shift + R)"
              data-testid="rotate-ccw-button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Rotate 90° CCW</span>
              <kbd className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[10px] text-zinc-400">
                ⇧R
              </kbd>
            </button>
            <button
              type="button"
              onClick={handleRotateCw}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 font-medium transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title="Rotate clockwise (R)"
              aria-label="Rotate clockwise (R)"
              data-testid="rotate-cw-button"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Rotate 90° CW</span>
              <kbd className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[10px] text-zinc-400">
                R
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 font-medium transition hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title="Zoom out (-)"
              aria-label="Zoom out (-)"
              data-testid="zoom-out-button"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-zinc-400">
                -
              </kbd>
            </button>
            <span
              className="w-12 text-center font-mono text-[11px] text-zinc-400"
              data-testid="zoom-level-indicator"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 font-medium transition hover:bg-white/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title="Zoom in (+)"
              aria-label="Zoom in (+)"
              data-testid="zoom-in-button"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-zinc-400">
                +
              </kbd>
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 font-medium transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              title="Reset zoom (0)"
              aria-label="Reset zoom (0)"
              data-testid="zoom-reset-button"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <kbd className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-zinc-400">
                0
              </kbd>
            </button>
          </div>
        </div>

        {/* Image Preview Canvas Area */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black/40 p-6 min-h-[300px]">
          {previewSrc ? (
            <div
              className="relative flex items-center justify-center transition-all duration-200"
              style={{
                aspectRatio,
                maxWidth: "100%",
                maxHeight: "50vh",
              }}
              data-testid="image-preview-container"
              data-swapped={isSwapped ? "true" : "false"}
            >
              {/* Offscreen image to load natural dimensions and draw onto canvas */}
              <img
                ref={imgRef}
                src={previewSrc}
                alt="Source preview"
                onLoad={handleImageLoad}
                className="hidden"
                data-testid="preview-source-image"
              />
              <canvas
                ref={canvasRef}
                width={targetWidth || 800}
                height={targetHeight || 600}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: "transform 150ms ease-out",
                  maxWidth: "100%",
                  maxHeight: "50vh",
                  objectFit: "contain",
                }}
                className="rounded-lg shadow-md select-none"
                data-testid="preview-canvas"
                data-target-width={targetWidth}
                data-target-height={targetHeight}
              />
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No image loaded</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 bg-zinc-950/70">
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-zinc-300">
                Esc
              </kbd>{" "}
              Cancel
            </span>
            <span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-zinc-300">
                ↵
              </kbd>{" "}
              Confirm
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              data-testid="cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || !previewSrc}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-sky-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              data-testid="confirm-upload-button"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{isSubmitting ? "Uploading..." : "Confirm & Upload"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImageUploadPreviewModal;
