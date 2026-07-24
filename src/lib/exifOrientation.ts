/**
 * EXIF Orientation Parser & Canvas Transformation Helper (src/lib/exifOrientation.ts)
 *
 * Reads EXIF metadata from smartphone camera uploads and applies canvas transformations
 * to normalize rotated/inverted images before rendering previews or uploading.
 */

/**
 * Extracts EXIF orientation integer (1-8) from a JPEG ArrayBuffer.
 * Returns 1 (normal / top-left) if non-JPEG or missing tag.
 */
export function getExifOrientation(arrayBuffer: ArrayBuffer): number {
  const dataView = new DataView(arrayBuffer);
  if (dataView.byteLength < 2 || dataView.getUint16(0, false) !== 0xffd8) {
    return 1; // Not a valid JPEG
  }

  let offset = 2;
  const length = dataView.byteLength;

  while (offset < length - 2) {
    const marker = dataView.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffe1) {
      // APP1 marker
      if (dataView.getUint32(offset + 2, false) !== 0x45786966) {
        return 1; // Not "Exif"
      }

      const littleEndian = dataView.getUint16(offset + 8, false) === 0x4949;
      const tiffOffset = offset + 8;
      const firstIfdOffset = dataView.getUint32(tiffOffset + 4, littleEndian);

      if (firstIfdOffset < 8) return 1;

      const tagsOffset = tiffOffset + firstIfdOffset;
      const tagsCount = dataView.getUint16(tagsOffset, littleEndian);

      for (let i = 0; i < tagsCount; i++) {
        const tagEntryOffset = tagsOffset + 2 + i * 12;
        if (tagEntryOffset + 12 > length) break;

        const tag = dataView.getUint16(tagEntryOffset, littleEndian);
        if (tag === 0x0112) {
          // EXIF Orientation Tag
          return dataView.getUint16(tagEntryOffset + 8, littleEndian);
        }
      }
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      const blockLength = dataView.getUint16(offset, false);
      offset += blockLength;
    }
  }

  return 1;
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read ArrayBuffer"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("Read error"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalizes a smartphone photo file by applying canvas transformation matrix
 * based on its EXIF orientation tag, returning an upright File object.
 */
export async function normalizeImageOrientation(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const orientation = getExifOrientation(buffer);

    if (orientation <= 1) {
      return file; // Already upright
    }

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          resolve(file);
          return;
        }

        const width = img.width;
        const height = img.height;

        if (orientation >= 5 && orientation <= 8) {
          canvas.width = height;
          canvas.height = width;
        } else {
          canvas.width = width;
          canvas.height = height;
        }

        switch (orientation) {
          case 2:
            ctx.transform(-1, 0, 0, 1, width, 0);
            break;
          case 3:
            ctx.transform(-1, 0, 0, -1, width, height);
            break;
          case 4:
            ctx.transform(1, 0, 0, -1, 0, height);
            break;
          case 5:
            ctx.transform(0, 1, 1, 0, 0, 0);
            break;
          case 6:
            ctx.transform(0, 1, -1, 0, height, 0);
            break;
          case 7:
            ctx.transform(0, -1, -1, 0, height, width);
            break;
          case 8:
            ctx.transform(0, -1, 1, 0, 0, width);
            break;
          default:
            break;
        }

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const normalizedFile = new File([blob], file.name, {
              type: file.type || "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(normalizedFile);
          },
          file.type || "image/jpeg",
          0.95,
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };

      img.src = url;
    });
  } catch (err) {
    console.error("Failed to parse/normalize EXIF orientation:", err);
    return file;
  }
}
