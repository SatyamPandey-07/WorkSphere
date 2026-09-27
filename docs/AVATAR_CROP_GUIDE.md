# Avatar Image Cropping & EXIF Orientation Guide

This document explains how WorkSphere handles user avatar uploads: EXIF orientation
normalization and the 1:1 crop modal flow.

---

## Overview

Smartphone cameras embed **EXIF orientation metadata** in JPEG files to indicate
how the raw sensor image should be rotated for display. Without normalization,
photos taken in portrait or landscape mode appear rotated in `<img>` tags on most
browsers because browsers only honour `image-orientation: from-image` when serving
from a CDN, not when displaying `File` object URLs directly.

WorkSphere normalizes orientation before cropping so the crop canvas always shows
an upright photo.

---

## Files

| File | Purpose |
|------|---------|
| `src/lib/exifOrientation.ts` | Parse EXIF orientation tag from JPEG JFIF header; rotate/mirror image on canvas |
| `src/components/CustomAvatarUpload.tsx` | File picker → dimension validation → EXIF normalize → open crop modal |
| `src/components/AvatarCropModal.tsx` | react-easy-crop powered 1:1 aspect ratio modal |

---

## Upload Flow

```
User picks a file
       │
       ▼
handleFileChange() in CustomAvatarUpload
       │
       ├─ Create ObjectURL from File
       ├─ Load image to check naturalWidth / naturalHeight
       │    └─ If either dimension < MIN_IMAGE_DIMENSION (100 px) → show error, abort
       │
       ├─ Set cropSource = objectURL
       └─ Open AvatarCropModal
              │
              ▼
       User drags crop area, clicks "Crop & Save"
              │
              ▼
       handleCroppedUpload(croppedFile)
              │
              ├─ normalizeImageOrientation(croppedFile) ← src/lib/exifOrientation.ts
              │    reads EXIF tag (1-8), draws to canvas with correct rotation
              │    returns a new File with upright orientation embedded
              │
              ▼
       Upload normalised File to /api/user/avatar (multipart/form-data)
```

---

## EXIF Orientation Values

The `getExifOrientation(arrayBuffer)` function reads the JFIF `0xFFE1` APP1 segment
and locates the `0x0112` Orientation tag. The returned integer maps to:

| Value | Description | Canvas transformation |
|-------|-------------|----------------------|
| 1 | Normal (no rotation) | None |
| 2 | Flipped horizontally | Mirror X |
| 3 | Rotated 180° | Rotate 180° |
| 4 | Flipped vertically | Mirror Y |
| 5 | Transposed | Rotate 90° CCW + Mirror X |
| 6 | Rotated 90° CW | Rotate 90° CW |
| 7 | Transverse | Rotate 90° CW + Mirror X |
| 8 | Rotated 90° CCW | Rotate 90° CCW |

Non-JPEG files (PNG, WebP, GIF) return `1` (no-op) since they carry no EXIF data.

---

## Key Functions

### `getExifOrientation(arrayBuffer: ArrayBuffer): number`

Parses a JPEG `ArrayBuffer` for the Orientation tag. Returns `1` if the file is
not a valid JPEG or does not contain an EXIF segment.

```typescript
import { getExifOrientation } from "@/lib/exifOrientation";

const buffer = await file.arrayBuffer();
const orientation = getExifOrientation(buffer); // 1–8
```

### `normalizeImageOrientation(file: File): Promise<File>`

High-level helper that:
1. Reads the file as `ArrayBuffer` to detect orientation.
2. Draws the image to a canvas with the corrective transformation applied.
3. Returns a new `File` (same MIME type) containing the correctly oriented image.
   The returned file has EXIF orientation tag `1` embedded so it displays upright
   everywhere.

```typescript
import { normalizeImageOrientation } from "@/lib/exifOrientation";

const normalised = await normalizeImageOrientation(croppedFile);
// normalised is an upright copy — safe to upload
```

---

## Dimension Validation

`CustomAvatarUpload` enforces a minimum resolution before opening the crop modal:

```typescript
const MIN_IMAGE_DIMENSION = 100; // px — defined near top of component

if (img.naturalWidth < MIN_IMAGE_DIMENSION || img.naturalHeight < MIN_IMAGE_DIMENSION) {
  setError(`Image resolution too low. Minimum ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION} required.`);
  return;
}
```

Images smaller than 100 × 100 px are rejected with a user-visible error. This
prevents the crop canvas from rendering unusably small previews and ensures the
resulting avatar meets minimum display quality.

---

## Crop Modal (`AvatarCropModal`)

Built on [`react-easy-crop`](https://github.com/ValentinH/react-easy-crop):

- **Aspect ratio:** locked to `1:1` for consistent circular avatar display.
- **Zoom:** slider from 1× to 3×.
- **Output:** `croppedAreaPixels` (pixel crop rectangle) is passed to a `getCroppedImg`
  helper that draws the crop to a canvas and returns a `Blob`.

---

## Testing

The test suite for this flow lives in:

```
src/__tests__/components/CustomAvatarUpload.test.tsx
```

Key test cases:
- Images smaller than 100 × 100 are rejected before opening the modal.
- Images ≥ 100 × 100 open the modal.
- `normalizeImageOrientation` is called on the cropped output before upload.

---

## Further Reading

- [EXIF specification — Orientation tag](https://www.exif.org/Exif2-2.PDF) (section 4.6.4, tag 0x0112)
- [react-easy-crop documentation](https://valentinh.github.io/react-easy-crop/)
- [`src/lib/exifOrientation.ts`](../src/lib/exifOrientation.ts) — full source with inline comments
