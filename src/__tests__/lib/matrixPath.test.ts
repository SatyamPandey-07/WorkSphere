import { matrixToSvgPath } from "@/lib/qr/matrixPath";
import { generateQRMatrix } from "@/lib/qr/svgQr";

describe("matrixToSvgPath", () => {
  it("returns an empty path for an empty or all-light matrix", () => {
    expect(matrixToSvgPath([])).toBe("");
    expect(matrixToSvgPath([[false, false]])).toBe("");
  });

  it("draws a single dark module as a unit square", () => {
    expect(matrixToSvgPath([[true]])).toBe("M0 0h1v1h-1z");
  });

  it("merges horizontal runs into one rectangle", () => {
    expect(matrixToSvgPath([[true, true, false, true]])).toBe(
      "M0 0h2v1h-2zM3 0h1v1h-1z",
    );
  });

  it("offsets each row by its y position", () => {
    expect(matrixToSvgPath([[false], [true]])).toBe("M0 1h1v1h-1z");
    expect(
      matrixToSvgPath([
        [true, false],
        [false, true],
      ]),
    ).toBe("M0 0h1v1h-1zM1 1h1v1h-1z");
  });

  it("produces only well-formed rectangles for a real QR matrix", () => {
    const path = matrixToSvgPath(generateQRMatrix("otpauth://totp/test"));
    expect(path.length).toBeGreaterThan(0);
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });
});
