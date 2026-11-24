import {
  BADGE_MAX_CHECK_INS,
  BADGE_MAX_NAME_LENGTH,
  BadgeValidationError,
  createNomadBadgeBlob,
  downloadNomadBadge,
  downloadNomadPassportPngBadge,
  escapeSvgText,
  generateNomadBadgeSvg,
  getNomadBadgeFilename,
  getNomadPassportPngFilename,
  renderSvgToPngBlob,
  validateBadgeParams,
} from "@/lib/profile/badgeGenerator";
import { downloadSVG } from "@/lib/qr/svgQr";
import { triggerBrowserDownload } from "@/lib/export/csvBuilder";

jest.mock("@/lib/qr/svgQr", () => ({
  downloadSVG: jest.fn(),
}));

jest.mock("@/lib/export/csvBuilder", () => ({
  triggerBrowserDownload: jest.fn(),
}));

const ISSUED = "2026-11-22T11:17:00.000Z";
const base = {
  displayName: "Alex Nomad",
  rank: "Explorer",
  verifiedCheckIns: 42,
  issuedAt: ISSUED,
};

function parseSvg(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("escapeSvgText", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeSvgText(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;",
    );
  });

  it("strips characters that are invalid in XML 1.0", () => {
    expect(escapeSvgText("a\u0000b\u0008c\u001Fd\u007Fe")).toBe("abcde");
  });
});

describe("validateBadgeParams", () => {
  it("returns normalized values for valid input", () => {
    const result = validateBadgeParams(base);
    expect(result.displayName).toBe("Alex Nomad");
    expect(result.rank).toBe("Explorer");
    expect(result.verifiedCheckIns).toBe(42);
    expect(result.issuedAt.toISOString()).toBe(ISSUED);
  });

  it("collapses whitespace and truncates long names", () => {
    const long = "A".repeat(BADGE_MAX_NAME_LENGTH + 20);
    const result = validateBadgeParams({ ...base, displayName: `  ${long}  ` });
    expect(Array.from(result.displayName)).toHaveLength(BADGE_MAX_NAME_LENGTH);
    expect(result.displayName.endsWith("\u2026")).toBe(true);
    expect(
      validateBadgeParams({ ...base, displayName: "Alex \n  Nomad" })
        .displayName,
    ).toBe("Alex Nomad");
  });

  it("does not split surrogate pairs when truncating", () => {
    const result = validateBadgeParams({
      ...base,
      displayName: "\u{1F30D}".repeat(BADGE_MAX_NAME_LENGTH + 5),
    });
    expect(Array.from(result.displayName)).toHaveLength(BADGE_MAX_NAME_LENGTH);
  });

  it.each([
    ["empty name", { displayName: "" }],
    ["blank name", { displayName: "   " }],
    ["non string name", { displayName: 5 as unknown as string }],
    ["empty rank", { rank: "" }],
    ["non string rank", { rank: null as unknown as string }],
    ["negative check-ins", { verifiedCheckIns: -1 }],
    ["fractional check-ins", { verifiedCheckIns: 1.5 }],
    ["NaN check-ins", { verifiedCheckIns: NaN }],
    ["Infinity check-ins", { verifiedCheckIns: Infinity }],
    ["string check-ins", { verifiedCheckIns: "7" as unknown as number }],
    ["too many check-ins", { verifiedCheckIns: BADGE_MAX_CHECK_INS + 1 }],
    ["invalid date", { issuedAt: "not a date" }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateBadgeParams({ ...base, ...override })).toThrow(
      BadgeValidationError,
    );
  });

  it("rejects missing params", () => {
    expect(() => validateBadgeParams(null as unknown as typeof base)).toThrow(
      BadgeValidationError,
    );
  });

  it("accepts zero check-ins and defaults issuedAt to now", () => {
    const result = validateBadgeParams({
      displayName: "A",
      rank: "Pioneer",
      verifiedCheckIns: 0,
    });
    expect(result.verifiedCheckIns).toBe(0);
    expect(Number.isNaN(result.issuedAt.getTime())).toBe(false);
  });
});

describe("generateNomadBadgeSvg", () => {
  it("renders the dynamic fields", () => {
    const svg = generateNomadBadgeSvg({ ...base, verifiedCheckIns: 1234 });
    expect(svg).toContain("Alex Nomad");
    expect(svg).toContain("EXPLORER");
    expect(svg).toContain("1,234");
    expect(svg).toContain("2026-11-22 11:17 UTC");
  });

  it("is deterministic for the same input", () => {
    expect(generateNomadBadgeSvg(base)).toBe(generateNomadBadgeSvg(base));
  });

  it("is self-contained, well formed XML with an svg root", () => {
    const svg = generateNomadBadgeSvg(base);
    const doc = parseSvg(svg);
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe("svg");
    expect(doc.documentElement.getAttribute("xmlns")).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 600 340");
    expect(doc.documentElement.getAttribute("width")).toBe("1200");
    expect(doc.documentElement.getAttribute("height")).toBe("680");
  });

  it("uses a gradient border and has no external references or scripts", () => {
    const svg = generateNomadBadgeSvg(base);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('stroke="url(#wsBorder)"');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/href\s*=/i);
    expect(svg).not.toMatch(/@import|url\(\s*["']?https?:/i);
  });

  it("neutralizes SVG and XML injection in the name", () => {
    const evil = `</text><script>alert(1)</script><text x="0">`;
    const svg = generateNomadBadgeSvg({ ...base, displayName: evil });
    const doc = parseSvg(svg);
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("script")).toHaveLength(0);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("neutralizes attribute breakout through the aria-label", () => {
    const evil = `" onload="alert(1)`;
    const svg = generateNomadBadgeSvg({
      ...base,
      displayName: evil,
      rank: evil,
    });
    const doc = parseSvg(svg);
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.hasAttribute("onload")).toBe(false);
    expect(svg).not.toMatch(/\sonload="/i);
  });

  it("escapes ampersands and entity lookalikes in the rank", () => {
    const svg = generateNomadBadgeSvg({ ...base, rank: "R&D &amp; Co" });
    expect(parseSvg(svg).getElementsByTagName("parsererror")).toHaveLength(0);
    expect(svg).toContain("R&amp;D &amp;AMP; CO");
  });

  it("uses a different accent for known ranks and a default for others", () => {
    const veteran = generateNomadBadgeSvg({ ...base, rank: "Veteran" });
    const pioneer = generateNomadBadgeSvg({ ...base, rank: "Pioneer" });
    const custom = generateNomadBadgeSvg({ ...base, rank: "Wanderer" });
    expect(veteran).toContain("#a78bfa");
    expect(pioneer).toContain("#fbbf24");
    expect(custom).toContain("#22d3ee");
  });

  it("throws on invalid params", () => {
    expect(() =>
      generateNomadBadgeSvg({ ...base, verifiedCheckIns: -5 }),
    ).toThrow(BadgeValidationError);
  });
});

describe("createNomadBadgeBlob", () => {
  it("returns an svg Blob containing the generated markup", async () => {
    const blob = createNomadBadgeBlob(base);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(blob.size).toBeGreaterThan(0);
    expect(await readBlob(blob)).toBe(generateNomadBadgeSvg(base));
  });

  it("throws on invalid params", () => {
    expect(() => createNomadBadgeBlob({ ...base, displayName: "" })).toThrow(
      BadgeValidationError,
    );
  });
});

describe("getNomadBadgeFilename", () => {
  it("slugifies the display name", () => {
    expect(getNomadBadgeFilename("Alex Nomad")).toBe(
      "nomad-badge-alex-nomad.svg",
    );
  });

  it("removes path separators and unsafe characters", () => {
    expect(getNomadBadgeFilename("../../etc/passwd")).toBe(
      "nomad-badge-etc-passwd.svg",
    );
  });

  it("falls back when nothing safe remains", () => {
    expect(getNomadBadgeFilename("!!!")).toBe("nomad-badge-member.svg");
    expect(getNomadBadgeFilename(undefined as unknown as string)).toBe(
      "nomad-badge-member.svg",
    );
  });
});

describe("downloadNomadBadge", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes the svg and a safe filename to downloadSVG", () => {
    downloadNomadBadge(base);
    expect(downloadSVG).toHaveBeenCalledTimes(1);
    expect(downloadSVG).toHaveBeenCalledWith(
      generateNomadBadgeSvg(base),
      "nomad-badge-alex-nomad.svg",
    );
  });

  it("does not download when params are invalid", () => {
    expect(() => downloadNomadBadge({ ...base, rank: "" })).toThrow(
      BadgeValidationError,
    );
    expect(downloadSVG).not.toHaveBeenCalled();
  });
});

describe("getNomadPassportPngFilename (#9721)", () => {
  it("slugifies username and appends .png", () => {
    expect(getNomadPassportPngFilename("Alex Nomad")).toBe(
      "nomad-passport-alex-nomad.png",
    );
    expect(getNomadPassportPngFilename("Jane_Doe #42")).toBe(
      "nomad-passport-jane-doe-42.png",
    );
  });

  it("falls back to nomad-passport-member.png when username is empty", () => {
    expect(getNomadPassportPngFilename("")).toBe("nomad-passport-member.png");
    expect(getNomadPassportPngFilename("   ")).toBe(
      "nomad-passport-member.png",
    );
    expect(getNomadPassportPngFilename(undefined as unknown as string)).toBe(
      "nomad-passport-member.png",
    );
  });
});

describe("renderSvgToPngBlob and downloadNomadPassportPngBadge (#9721)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders SVG onto canvas at 2x scale and outputs PNG blob", async () => {
    const origCreateElement = document.createElement.bind(document);
    const mockBlob = new Blob(["png-data"], { type: "image/png" });

    const mockImage = {
      onload: null as any,
      onerror: null as any,
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 10);
      },
    };
    const origImage = global.Image;
    global.Image = jest.fn(() => mockImage as any);

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:mock-svg");
    URL.revokeObjectURL = jest.fn();

    const mockCtx = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };

    jest
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        const el = origCreateElement(tagName);
        if (tagName === "canvas") {
          (el as any).getContext = jest.fn(() => mockCtx);
          (el as any).toBlob = jest.fn((cb: any) => cb(mockBlob));
        }
        return el;
      });

    const svg = generateNomadBadgeSvg(base);
    const blob = await renderSvgToPngBlob(svg, 2);

    expect(blob).toBe(mockBlob);
    expect(mockCtx.drawImage).toHaveBeenCalled();

    global.Image = origImage;
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it("downloads PNG badge named nomad-passport-[username].png", async () => {
    const mockBlob = new Blob(["png-data"], { type: "image/png" });
    const mockImage = {
      onload: null as any,
      onerror: null as any,
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 10);
      },
    };
    const origImage = global.Image;
    global.Image = jest.fn(() => mockImage as any);

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:mock-svg");
    URL.revokeObjectURL = jest.fn();

    const origCreateElement = document.createElement.bind(document);
    jest
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        const el = origCreateElement(tagName);
        if (tagName === "canvas") {
          (el as any).getContext = jest.fn(() => ({
            clearRect: jest.fn(),
            drawImage: jest.fn(),
          }));
          (el as any).toBlob = jest.fn((cb: any) => cb(mockBlob));
        }
        return el;
      });

    await downloadNomadPassportPngBadge(base, 2);

    expect(triggerBrowserDownload).toHaveBeenCalledWith(
      mockBlob,
      "nomad-passport-alex-nomad.png",
    );

    global.Image = origImage;
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    jest.restoreAllMocks();
  });
});
