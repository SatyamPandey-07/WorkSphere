/**
 * Tests for image lazy loading intersection observer config.
 */

interface LazyImageConfig {
  src: string;
  placeholder: string;
  alt: string;
  width: number;
  height: number;
  loaded: boolean;
}

function shouldLoad(config: LazyImageConfig, isIntersecting: boolean): boolean {
  return isIntersecting && !config.loaded;
}

function markLoaded(config: LazyImageConfig): LazyImageConfig {
  return { ...config, loaded: true };
}

function aspectRatio(config: LazyImageConfig): number {
  if (config.height === 0) return 0;
  return config.width / config.height;
}

function buildSrcSet(src: string, widths: number[]): string {
  return widths
    .map((w) => {
      const ext = src.match(/\.[^.]+$/)?.[0] ?? "";
      const base = src.replace(/\.[^.]+$/, "");
      return `${base}-${w}w${ext} ${w}w`;
    })
    .join(", ");
}

const CONFIG: LazyImageConfig = {
  src: "venue.jpg",
  placeholder: "placeholder.jpg",
  alt: "Venue photo",
  width: 800,
  height: 600,
  loaded: false,
};

describe("Image lazy load observer", () => {
  it("shouldLoad: intersecting and not loaded → true", () => {
    expect(shouldLoad(CONFIG, true)).toBe(true);
  });

  it("shouldLoad: not intersecting → false", () => {
    expect(shouldLoad(CONFIG, false)).toBe(false);
  });

  it("shouldLoad: already loaded → false", () => {
    expect(shouldLoad({ ...CONFIG, loaded: true }, true)).toBe(false);
  });

  it("markLoaded sets loaded to true", () => {
    const loaded = markLoaded(CONFIG);
    expect(loaded.loaded).toBe(true);
  });

  it("markLoaded is immutable", () => {
    markLoaded(CONFIG);
    expect(CONFIG.loaded).toBe(false);
  });

  it("aspectRatio: 800/600 ≈ 1.33", () => {
    expect(aspectRatio(CONFIG)).toBeCloseTo(4 / 3);
  });

  it("aspectRatio: zero height → 0", () => {
    expect(aspectRatio({ ...CONFIG, height: 0 })).toBe(0);
  });

  it("buildSrcSet: generates correct format", () => {
    const srcset = buildSrcSet("venue.jpg", [400, 800]);
    expect(srcset).toContain("venue-400w.jpg 400w");
    expect(srcset).toContain("venue-800w.jpg 800w");
  });

  it("buildSrcSet: multiple entries comma-separated", () => {
    const srcset = buildSrcSet("venue.jpg", [400, 800, 1200]);
    expect(srcset.split(",")).toHaveLength(3);
  });
});
