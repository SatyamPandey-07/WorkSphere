export interface ImageCompressionOptions {
  maxDimension?: number;
  maxBytes?: number;
  initialQuality?: number;
  minQuality?: number;
  qualityStep?: number;
  preferredMimeType?: 'image/webp' | 'image/jpeg';
  fallbackMimeType?: 'image/jpeg';
}

export interface ImageCompressionResult {
  file: File;
  compressed: boolean;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  outputSize: number;
}

export const MAX_IMAGE_DIMENSION = 1920;
export const MAX_COMPRESSED_BYTES = 1.5 * 1024 * 1024;
export const DEFAULT_IMAGE_QUALITY = 0.8;

export function calculateScaledDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const largestSide = Math.max(width, height);
  if (largestSide <= maxDimension) {
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }
  const scale = maxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function replaceExtension(filename: string, mimeType: string): string {
  const ext = mimeType === 'image/webp' ? '.webp' : '.jpg';
  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${base}${ext}`;
}

async function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') {
    return null;
  }
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<ImageCompressionResult> {
  const originalSize = file.size;
  if (!file.type || !file.type.startsWith('image/')) {
    return {
      file,
      compressed: false,
      mimeType: file.type || 'application/octet-stream',
      width: 0,
      height: 0,
      originalSize,
      outputSize: originalSize,
    };
  }

  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return {
      file,
      compressed: false,
      mimeType: file.type,
      width: 0,
      height: 0,
      originalSize,
      outputSize: originalSize,
    };
  }

  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;
  const maxBytes = options.maxBytes ?? MAX_COMPRESSED_BYTES;
  const initialQuality = options.initialQuality ?? DEFAULT_IMAGE_QUALITY;
  const minQuality = options.minQuality ?? 0.45;
  const qualityStep = options.qualityStep ?? 0.1;
  const preferredMimeType = options.preferredMimeType ?? 'image/webp';
  const fallbackMimeType = options.fallbackMimeType ?? 'image/jpeg';

  const bitmap = await createImageBitmap(file);
  try {
    let targetDims = calculateScaledDimensions(
      bitmap.width,
      bitmap.height,
      maxDimension
    );

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        file,
        compressed: false,
        mimeType: file.type,
        width: bitmap.width,
        height: bitmap.height,
        originalSize,
        outputSize: originalSize,
      };
    }

    canvas.width = targetDims.width;
    canvas.height = targetDims.height;
    ctx.drawImage(bitmap, 0, 0, targetDims.width, targetDims.height);

    let activeMime = preferredMimeType;
    let bestBlob = await canvasToBlobAsync(canvas, activeMime, initialQuality);

    if (!bestBlob || bestBlob.type !== activeMime) {
      activeMime = fallbackMimeType;
      bestBlob = await canvasToBlobAsync(canvas, activeMime, initialQuality);
    }

    if (!bestBlob) {
      return {
        file,
        compressed: false,
        mimeType: file.type,
        width: targetDims.width,
        height: targetDims.height,
        originalSize,
        outputSize: originalSize,
      };
    }

    let quality = initialQuality - qualityStep;
    while (bestBlob.size > maxBytes && quality >= minQuality) {
      const candidate = await canvasToBlobAsync(canvas, activeMime, quality);
      if (candidate && candidate.size < bestBlob.size) {
        bestBlob = candidate;
      }
      quality = Number((quality - qualityStep).toFixed(2));
    }

    let currentMaxDim = maxDimension;
    while (bestBlob.size > maxBytes && currentMaxDim > 640) {
      currentMaxDim = Math.max(640, Math.round(currentMaxDim * 0.8));
      targetDims = calculateScaledDimensions(
        bitmap.width,
        bitmap.height,
        currentMaxDim
      );
      canvas.width = targetDims.width;
      canvas.height = targetDims.height;
      ctx.drawImage(bitmap, 0, 0, targetDims.width, targetDims.height);

      const resizedBlob = await canvasToBlobAsync(
        canvas,
        activeMime,
        Math.max(minQuality, initialQuality - 0.1)
      );
      if (resizedBlob && resizedBlob.size < bestBlob.size) {
        bestBlob = resizedBlob;
      } else {
        break;
      }
    }

    const outputFile = new File(
      [bestBlob],
      replaceExtension(file.name, activeMime),
      {
        type: activeMime,
        lastModified: Date.now(),
      }
    );

    return {
      file: outputFile,
      compressed: true,
      mimeType: activeMime,
      width: targetDims.width,
      height: targetDims.height,
      originalSize,
      outputSize: outputFile.size,
    };
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}