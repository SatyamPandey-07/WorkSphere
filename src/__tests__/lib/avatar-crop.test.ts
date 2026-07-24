import {
  AVATAR_OUTPUT_SIZE,
  createCroppedAvatarFile,
  cropImageToWebP,
} from "@/lib/avatar-crop";

describe("avatar crop utilities", () => {
  it("creates a WebP file with a stable cropped filename", () => {
    const blob = new Blob(["avatar"], {
      type: "image/webp",
    });

    const file = createCroppedAvatarFile(blob, "profile.photo.jpeg");

    expect(file.name).toBe("profile.photo-cropped.webp");
    expect(file.type).toBe("image/webp");
  });

  it("rejects non-positive crop dimensions", async () => {
    await expect(
      cropImageToWebP("blob:test", {
        x: 0,
        y: 0,
        width: 0,
        height: 100,
      }),
    ).rejects.toThrow("Crop dimensions must be positive.");
  });

  it("caps the exported size at 512 pixels", async () => {
    const drawImage = jest.fn();
    const fillRect = jest.fn();
    const toBlob = jest.fn((callback: BlobCallback, type?: string) => {
      callback(
        new Blob(["cropped"], {
          type: type ?? "image/webp",
        }),
      );
    });

    const canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => ({
        drawImage,
        fillRect,
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        fillStyle: "",
      })),
      toBlob,
    } as unknown as HTMLCanvasElement;

    jest.spyOn(document, "createElement").mockReturnValue(canvas);

    const originalImage = global.Image;

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      private value = "";

      set src(nextSource: string) {
        this.value = nextSource;
        queueMicrotask(() => this.onload?.());
      }

      get src() {
        return this.value;
      }
    }

    Object.defineProperty(global, "Image", {
      configurable: true,
      value: MockImage,
    });

    try {
      const blob = await cropImageToWebP(
        "blob:test",
        {
          x: 10,
          y: 20,
          width: 300,
          height: 300,
        },
        AVATAR_OUTPUT_SIZE * 2,
      );

      expect(blob.type).toBe("image/webp");
      expect(canvas.width).toBe(512);
      expect(canvas.height).toBe(512);
      expect(drawImage).toHaveBeenCalledWith(
        expect.any(MockImage),
        10,
        20,
        300,
        300,
        0,
        0,
        512,
        512,
      );
      expect(toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        "image/webp",
        0.86,
      );
    } finally {
      Object.defineProperty(global, "Image", {
        configurable: true,
        value: originalImage,
      });
      jest.restoreAllMocks();
    }
  });
});
