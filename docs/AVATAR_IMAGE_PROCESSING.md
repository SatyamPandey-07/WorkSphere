# Avatar Image Processing Pipeline

WorkSphere handles smartphone avatar uploads with a client-side pipeline that normalizes EXIF orientation, converts HEIC files, and enforces size limits — all before uploading to the server.

**Source files:**
- `src/lib/exifOrientation.ts` — EXIF parser and canvas normalization
- `src/components/ReactiveUserButton.tsx` — Upload trigger and preview

---

## 1. File Intake & Validation

When a user selects an image:

1. File type is checked — JPEG, PNG, WebP, GIF, and HEIC/HEIF are accepted
2. **5 MB source size limit** is enforced before any processing begins
3. HEIC/HEIF files are converted to JPEG using `heic2any` (client-side, no server round-trip)

---

## 2. EXIF Orientation Normalization

Smartphone cameras embed an EXIF orientation tag (1–8) instead of physically rotating the pixel data. Without normalization, images appear rotated or mirrored in browsers that don't honor the tag.

### EXIF Orientation Tags

| Tag | Description | Canvas transformation |
|-----|-------------|-----------------------|
| 1 | Normal (top-left) | Identity — no transform |
| 2 | Mirrored horizontal | `transform(-1, 0, 0, 1, width, 0)` |
| 3 | 180° rotated | `transform(-1, 0, 0, -1, width, height)` |
| 4 | Mirrored vertical | `transform(1, 0, 0, -1, 0, height)` |
| 5 | Mirrored + 270° CW | Swap dimensions; `transform(0, 1, 1, 0, 0, 0)` |
| 6 | 90° CW (most phones) | Swap dimensions; `transform(0, 1, -1, 0, height, 0)` |
| 7 | Mirrored + 90° CW | Swap dimensions; `transform(0, -1, -1, 0, height, width)` |
| 8 | 270° CW | Swap dimensions; `transform(0, -1, 1, 0, 0, width)` |

Tags 5–8 require swapping canvas width/height before drawing because the image is rotated 90° or 270°.

### Implementation (`src/lib/exifOrientation.ts`)

```
File → ArrayBuffer → getExifOrientation() → tag
  → create OffscreenCanvas (or regular Canvas)
  → ctx.transform(matrix for tag)
  → ctx.drawImage(source)
  → canvas.toBlob("image/jpeg")
  → new File([blob], ...)
```

Memory cleanup: `URL.revokeObjectURL(url)` is called in both the success and error paths to prevent heap leaks from object URLs created for intermediate image elements.

---

## 3. HEIC/HEIF Conversion

iPhone cameras default to HEIC format. WorkSphere converts HEIC to JPEG client-side via `heic2any`:

```ts
const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
```

This avoids server-side ImageMagick/FFmpeg dependencies. The result is then passed through the EXIF normalization pipeline.

---

## 4. Manual Testing Checklist

| Scenario | Steps | Expected result |
|----------|-------|-----------------|
| iPhone portrait photo | Upload HEIC from Camera Roll | Displays upright, no rotation |
| iPhone landscape photo | Upload HEIC taken in landscape | Displays upright |
| Rotated JPEG (tag 6) | Upload a JPEG with EXIF tag 6 | Auto-rotated to upright |
| Mirrored selfie (tag 2) | Upload front-camera JPEG | No horizontal mirror |
| File > 5 MB | Select a large PNG | Error: "File size must be under 5 MB" |
| Valid PNG < 5 MB | Upload PNG | Preview and upload succeed |

To simulate rotated EXIFs without a camera, use [ExifTool](https://exiftool.org/):
```bash
exiftool -Orientation=6 -n test.jpg   # sets 90° CW rotation tag
```
