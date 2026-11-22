import {
  compressImageFile,
  MAX_COMPRESSED_BYTES,
  MAX_IMAGE_DIMENSION,
} from '@/lib/media/imageCompressor';

describe('compressImageFile', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  it('bypasses non-image files transparently', async () => {
    const docFile = new File(['hello world'], 'notes.pdf', {
      type: 'application/pdf',
    });

    const result = await compressImageFile(docFile);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(docFile);
    expect(result.outputSize).toBe(docFile.size);
  });

  it('downscales oversized images to <= 1920px preserving aspect ratio and compresses to WebP', async () => {
    const mockCtx = {
      drawImage: jest.fn(),
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn().mockReturnValue(mockCtx),
      toBlob: jest.fn(
        (cb: (blob: Blob | null) => void, mimeType: string) => {
          const payload = new Uint8Array(400_000);
          cb(new Blob([payload], { type: mimeType }));
        }
      ),
    };

    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return mockCanvas as unknown as HTMLCanvasElement;
      }
      return HTMLElement.prototype.tagName ? ({} as HTMLElement) : ({} as HTMLElement);
    }) as typeof document.createElement);

    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest
      .fn()
      .mockResolvedValue({
        width: 4000,
        height: 3000,
        close: jest.fn(),
      });

    const largePhoto = new File([new Uint8Array(6 * 1024 * 1024)], 'photo.jpg', {
      type: 'image/jpeg',
    });

    const res = await compressImageFile(largePhoto);

    expect(res.compressed).toBe(true);
    expect(res.width).toBe(MAX_IMAGE_DIMENSION);
    expect(res.height).toBe(1440);
    expect(res.mimeType).toBe('image/webp');
    expect(res.file.name).toBe('photo.webp');
    expect(res.outputSize).toBeLessThan(res.originalSize);
    expect(res.outputSize).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it('falls back to image/jpeg when image/webp is unavailable', async () => {
    const mockCtx = { drawImage: jest.fn() };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn().mockReturnValue(mockCtx),
      toBlob: jest.fn(
        (cb: (blob: Blob | null) => void, mimeType: string) => {
          if (mimeType === 'image/webp') {
            cb(new Blob(['fallback'], { type: 'image/png' }));
            return;
          }
          cb(new Blob([new Uint8Array(250_000)], { type: 'image/jpeg' }));
        }
      ),
    };

    jest.spyOn(document, 'createElement').mockReturnValue(
      mockCanvas as unknown as HTMLCanvasElement
    );

    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest
      .fn()
      .mockResolvedValue({
        width: 1200,
        height: 800,
        close: jest.fn(),
      });

    const imgFile = new File([new Uint8Array(3 * 1024 * 1024)], 'scene.png', {
      type: 'image/png',
    });

    const res = await compressImageFile(imgFile);

    expect(res.compressed).toBe(true);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.file.name).toBe('scene.jpg');
    expect(res.width).toBe(1200);
    expect(res.height).toBe(800);
  });
});