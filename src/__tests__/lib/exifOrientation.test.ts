import {
  getExifOrientation,
  normalizeImageOrientation,
} from "@/lib/exifOrientation";

function createMockJpegBuffer(orientation: number): ArrayBuffer {
  // Construct a minimal JPEG binary with APP1 EXIF segment containing orientation tag 0x0112
  const buffer = new ArrayBuffer(100);
  const view = new DataView(buffer);

  // JPEG SOI marker
  view.setUint16(0, 0xffd8, false);

  // APP1 marker 0xFFE1
  view.setUint16(2, 0xffe1, false);
  view.setUint16(4, 50, false); // Length

  // Exif\0\0 header
  view.setUint32(6, 0x45786966, false);
  view.setUint16(10, 0x0000, false);

  // TIFF Header (Little Endian 'II')
  view.setUint16(12, 0x4949, false); // II
  view.setUint16(14, 0x002a, true); // 42
  view.setUint32(16, 8, true); // IFD0 offset (relative to TIFF header start at byte 12) => byte 20

  // IFD0: 1 tag
  view.setUint16(20, 1, true);

  // Tag 0x0112 (Orientation), Type SHORT (3), Count 1, Value
  view.setUint16(22, 0x0112, true); // Tag
  view.setUint16(24, 3, true); // Type (SHORT)
  view.setUint32(26, 1, true); // Count
  view.setUint16(30, orientation, true); // Orientation Value (e.g. 6)

  return buffer;
}

describe("EXIF Orientation Parser (src/lib/exifOrientation.ts)", () => {
  it("returns orientation 1 for non-JPEG buffers", () => {
    const pngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(getExifOrientation(pngBuffer)).toBe(1);
  });

  it("extracts orientation 6 (portrait 90 deg CW) from JPEG EXIF metadata", () => {
    const jpegBuffer = createMockJpegBuffer(6);
    expect(getExifOrientation(jpegBuffer)).toBe(6);
  });

  it("extracts orientation 3 (180 deg upside down) from JPEG EXIF metadata", () => {
    const jpegBuffer = createMockJpegBuffer(3);
    expect(getExifOrientation(jpegBuffer)).toBe(3);
  });

  it("extracts orientation 8 (90 deg CCW) from JPEG EXIF metadata", () => {
    const jpegBuffer = createMockJpegBuffer(8);
    expect(getExifOrientation(jpegBuffer)).toBe(8);
  });

  it("returns original file when orientation is already 1", async () => {
    const dummyFile = new File(["dummy data"], "photo.jpg", {
      type: "image/jpeg",
    });
    dummyFile.arrayBuffer = async () => new ArrayBuffer(0);
    const result = await normalizeImageOrientation(dummyFile);
    expect(result).toBe(dummyFile);
  });

  it("normalizes smartphone photo File with EXIF orientation > 1 via canvas transformation", async () => {
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/mock");
    global.URL.revokeObjectURL = jest.fn();

    const mockJpegBytes = createMockJpegBuffer(6);
    const mockFile = new File([mockJpegBytes], "smartphone_portrait.jpg", {
      type: "image/jpeg",
    });
    mockFile.arrayBuffer = async () => mockJpegBytes;

    // Mock HTMLImageElement and HTMLCanvasElement in JSDOM
    const originalImage = window.Image;
    const originalCreateElement = document.createElement;

    // @ts-expect-error test mock
    window.Image = class MockImage {
      onload: (() => void) | null = null;
      width = 1920;
      height = 1080;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 10);
      }
    };

    const mockCtx = {
      transform: jest.fn(),
      drawImage: jest.fn(),
    };

    (document.createElement as any) = (tagName: string) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
          toBlob: (cb: (blob: Blob | null) => void) => {
            cb(new Blob(["normalized-jpeg-bytes"], { type: "image/jpeg" }));
          },
        } as any;
      }
      return originalCreateElement.call(document, tagName);
    };

    const normalizedFile = await normalizeImageOrientation(mockFile);

    expect(normalizedFile).not.toBe(mockFile);
    expect(normalizedFile.name).toBe("smartphone_portrait.jpg");
    expect(mockCtx.transform).toHaveBeenCalledWith(0, 1, -1, 0, 1080, 0); // Case 6 transformation

    window.Image = originalImage;
    document.createElement = originalCreateElement;
  });
});
