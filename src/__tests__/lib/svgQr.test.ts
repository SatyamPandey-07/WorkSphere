import {
  generateQRMatrix,
  generateQRCodeSVG,
  downloadSVG,
} from "@/lib/qr/svgQr";

describe("QR Code SVG Generator", () => {
  it("generates a valid QR matrix for short and medium URLs", () => {
    const matrixShort = generateQRMatrix("https://worksphere.app/v/123");
    expect(matrixShort.length).toBeGreaterThanOrEqual(21);
    expect(matrixShort[0].length).toBe(matrixShort.length);

    // Finder pattern in top-left should be 7x7 dark border
    expect(matrixShort[0][0]).toBe(true);
    expect(matrixShort[0][6]).toBe(true);
    expect(matrixShort[6][0]).toBe(true);
    expect(matrixShort[6][6]).toBe(true);
  });

  it("safely coerces nullish or non-string input in generateQRMatrix", () => {
    expect(() => generateQRMatrix(null as any)).not.toThrow();
    expect(generateQRMatrix(null as any).length).toBeGreaterThanOrEqual(21);
    expect(generateQRMatrix(12345 as any).length).toBeGreaterThanOrEqual(21);
  });

  it("generates a valid SVG string with correct viewBox and attributes", () => {
    const url = "https://worksphere.app/venues/cm80abcdef123456";
    const svg = generateQRCodeSVG(url, {
      size: 250,
      title: "Venue QR Code",
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain('width="250"');
    expect(svg).toContain('height="250"');
    expect(svg).toContain("<title>Venue QR Code</title>");
    expect(svg).toContain("<path");
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("merges horizontal runs into compact path rectangles", () => {
    const svg = generateQRCodeSVG("https://worksphere.app");
    // Merged horizontal runs format like `h7v1h-7z` for finder patterns
    expect(svg).toMatch(/h[2-9]\d*v1h-[2-9]\d*z/);
  });

  it("supports custom colors and transparent background", () => {
    const svg = generateQRCodeSVG("https://worksphere.app", {
      fgColor: "#4f46e5",
      bgColor: "transparent",
    });

    expect(svg).toContain('fill="#4f46e5"');
    expect(svg).not.toContain('<rect width=');
  });

  it("escapes markup in the title so venue names cannot break out", () => {
    const svg = generateQRCodeSVG("https://worksphere.app/venues/1", {
      title: '"><img src=x onerror=alert(1)> QR Code',
    });

    expect(svg).not.toContain('"><img');
    expect(svg).toContain("&quot;&gt;&lt;img src=x QR Code");
  });

  it("triggers download in browser environment without throwing", () => {
    const createObjectURLMock = jest.fn(() => "blob:mock-url");
    const revokeObjectURLMock = jest.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    const appendChildSpy = jest.spyOn(document.body, "appendChild");
    const removeChildSpy = jest.spyOn(document.body, "removeChild");

    const svg = generateQRCodeSVG("https://worksphere.app");
    downloadSVG(svg, "test-venue-qr.svg");

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it("ensures .svg extension and handles fallback filename in downloadSVG", () => {
    const createObjectURLMock = jest.fn(() => "blob:mock-url");
    const revokeObjectURLMock = jest.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    let downloadedFilename = "";
    const appendChildSpy = jest
      .spyOn(document.body, "appendChild")
      .mockImplementation((node: any) => {
        downloadedFilename = node.download;
        return node;
      });
    const removeChildSpy = jest
      .spyOn(document.body, "removeChild")
      .mockImplementation((node: any) => node);

    const svg = generateQRCodeSVG("https://worksphere.app");

    // Without extension
    downloadSVG(svg, "custom-name");
    expect(downloadedFilename).toBe("custom-name.svg");

    // Undefined / empty filename
    downloadSVG(svg, undefined as any);
    expect(downloadedFilename).toBe("qr-code.svg");

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });
});
