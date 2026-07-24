export type PixelCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_WEBP_QUALITY = 0.86;

function assertValidCrop(crop: PixelCrop): void {
  const values = [crop.x, crop.y, crop.width, crop.height];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Crop coordinates must be finite numbers.");
  }

  if (crop.width <= 0 || crop.height <= 0) {
    throw new Error("Crop dimensions must be positive.");
  }
}

export function createImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Unable to read the selected image."));
    image.decoding = "async";
    image.src = source;
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/webp",
  quality = AVATAR_WEBP_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to create the cropped image."));
      },
      type,
      quality,
    );
  });
}

export async function cropImageToWebP(
  source: string,
  crop: PixelCrop,
  outputSize = AVATAR_OUTPUT_SIZE,
): Promise<Blob> {
  assertValidCrop(crop);

  if (!Number.isInteger(outputSize) || outputSize <= 0) {
    throw new Error("Output size must be a positive integer.");
  }

  const size = Math.min(outputSize, AVATAR_OUTPUT_SIZE);
  const image = await createImage(source);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false,
  });

  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  canvas.width = size;
  canvas.height = size;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size,
  );

  return canvasToBlob(canvas);
}

export function createCroppedAvatarFile(
  blob: Blob,
  originalName: string,
): File {
  const baseName = originalName.replace(/\.[^/.]+$/, "").trim() || "avatar";

  return new File([blob], `${baseName}-cropped.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}
