import { generateBlurSvgDataUri } from "@/lib/image/blurPlaceholder";

describe("generateBlurSvgDataUri (#3774)", () => {
  it("generates a valid SVG data URI when blurhash or string is provided", () => {
    const dataUri = generateBlurSvgDataUri("LEHLk~WB2yk8pyo0adR*.7kCMdnj");
    expect(dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(dataUri).toContain("linearGradient");
    expect(dataUri).toContain("feGaussianBlur");
  });

  it("degrades gracefully to fallback gradient when blurhash is null or empty", () => {
    const nullUri = generateBlurSvgDataUri(null);
    expect(nullUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);

    const emptyUri = generateBlurSvgDataUri("");
    expect(emptyUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });

  it("produces deterministic output for the same input hash", () => {
    const uri1 = generateBlurSvgDataUri("test-blurhash-string");
    const uri2 = generateBlurSvgDataUri("test-blurhash-string");
    expect(uri1).toEqual(uri2);
  });
});
