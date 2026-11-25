import {
  buildCsvContentDisposition,
  sanitizeCsvFilename,
  sanitizeCsvFilenameStem,
} from "@/lib/export/csvFilename";

describe("CSV export filenames", () => {
  it("preserves safe characters in normal folder names", () => {
    expect(sanitizeCsvFilenameStem("Team-Alpha_2")).toBe("Team-Alpha_2");
    expect(sanitizeCsvFilename("Team-Alpha_2")).toBe("Team-Alpha_2.csv");
  });

  it("replaces quotes and spaces with underscores", () => {
    expect(sanitizeCsvFilename('Team "A" West')).toBe("Team__A__West.csv");
  });

  it("replaces path separators and traversal characters", () => {
    const filename = sanitizeCsvFilename("../../Finance\\Reports");

    expect(filename).toBe("______Finance_Reports.csv");
    expect(filename.slice(0, -".csv".length)).not.toMatch(/[./\\]/);
  });

  it("replaces CRLF and header-injection characters", () => {
    expect(sanitizeCsvFilename("folder\r\nX-Injected: 1")).toBe(
      "folder__X-Injected__1.csv",
    );
  });

  it("replaces Unicode characters that are outside the allowed filename set", () => {
    expect(sanitizeCsvFilename("Café")).toBe("Caf_.csv");
  });

  it("uses a safe fallback for empty and fully invalid names", () => {
    expect(sanitizeCsvFilename("")).toBe("folder.csv");
    expect(sanitizeCsvFilename("🔥")).toBe("folder.csv");
    expect(sanitizeCsvFilenameStem("///")).toBe("folder");
  });

  it("normalizes repeated or mixed-case CSV extensions to one .csv suffix", () => {
    expect(sanitizeCsvFilename("report.csv.csv")).toBe("report.csv");
    expect(sanitizeCsvFilename("report.CSV")).toBe("report.csv");
  });

  it("builds a safe Content-Disposition with an RFC 5987 filename", () => {
    expect(buildCsvContentDisposition('folder\r\n"report".csv')).toBe(
      "attachment; filename=\"folder___report_.csv\"; filename*=UTF-8''folder___report_.csv",
    );
  });
});
