import {
  exportFeedbackToCSV,
  downloadFeedbackCSV,
  createFeedbackCsvBuilder,
  type FeedbackFlag,
} from "@/lib/feedbackCsvExport";

const makeFlag = (overrides: Partial<FeedbackFlag> = {}): FeedbackFlag => ({
  id: "flag-1",
  type: "VENUE",
  reason: "Wrong information",
  status: "PENDING",
  createdAt: new Date("2026-10-04T09:30:00.000Z"),
  reportedBy: {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
  },
  itemDetails: { name: "Blue Tokai" },
  ...overrides,
});

describe("exportFeedbackToCSV", () => {
  it("starts with the header row", () => {
    expect(exportFeedbackToCSV([])).toBe(
      "Type,Status,Reason,Target,Venue,Reported By,Reporter Email,Date",
    );
  });

  it("handles null or undefined flags safely", () => {
    expect(exportFeedbackToCSV(null as any)).toBe(
      "Type,Status,Reason,Target,Venue,Reported By,Reporter Email,Date",
    );
    expect(exportFeedbackToCSV(undefined)).toBe(
      "Type,Status,Reason,Target,Venue,Reported By,Reporter Email,Date",
    );
  });

  it("writes a venue row with its name and reporter", () => {
    const row = exportFeedbackToCSV([makeFlag()]).split("\r\n")[1];
    expect(row).toBe(
      "VENUE,PENDING,Wrong information,Blue Tokai,,Ada Lovelace,ada@example.com,2026-10-04T09:30:00.000Z",
    );
  });

  it("quotes a reason that contains a comma", () => {
    const csv = exportFeedbackToCSV([
      makeFlag({ reason: "Closed, but listed as open" }),
    ]);
    expect(csv).toContain('"Closed, but listed as open"');
  });

  it("doubles internal quotes in a reason", () => {
    const csv = exportFeedbackToCSV([
      makeFlag({ reason: 'Staff said "come back later"' }),
    ]);
    expect(csv).toContain('"Staff said ""come back later"""');
  });

  it("wraps a reason that contains a newline", () => {
    const csv = exportFeedbackToCSV([
      makeFlag({ reason: "Line one\nLine two" }),
    ]);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it("uses the review comment and venue name for review flags", () => {
    const csv = exportFeedbackToCSV([
      makeFlag({
        type: "REVIEW",
        itemDetails: { comment: "Rude staff", venue: { name: "Cafe X" } },
      }),
    ]);
    expect(csv).toContain("REVIEW,PENDING,Wrong information,Rude staff,Cafe X,");
  });

  it("safely handles invalid Date in createdAt without throwing RangeError", () => {
    const invalidDateFlag = makeFlag({
      createdAt: new Date("invalid-date-string"),
    });
    expect(() => exportFeedbackToCSV([invalidDateFlag])).not.toThrow();
    const row = exportFeedbackToCSV([invalidDateFlag]).split("\r\n")[1];
    expect(row).toBe(
      "VENUE,PENDING,Wrong information,Blue Tokai,,Ada Lovelace,ada@example.com,",
    );
  });

  it("safely handles missing or null reportedBy", () => {
    const anonFlag = makeFlag({
      reportedBy: null,
    });
    expect(() => exportFeedbackToCSV([anonFlag])).not.toThrow();
    const row = exportFeedbackToCSV([anonFlag]).split("\r\n")[1];
    expect(row).toBe("VENUE,PENDING,Wrong information,Blue Tokai,,,,2026-10-04T09:30:00.000Z");
  });

  it("safely handles null itemDetails or missing venue", () => {
    const noDetailsFlag = makeFlag({
      itemDetails: null,
    });
    expect(() => exportFeedbackToCSV([noDetailsFlag])).not.toThrow();
    const row = exportFeedbackToCSV([noDetailsFlag]).split("\r\n")[1];
    expect(row).toBe("VENUE,PENDING,Wrong information,,,Ada Lovelace,ada@example.com,2026-10-04T09:30:00.000Z");
  });

  it("supports custom lineDelimiter and BOM in createFeedbackCsvBuilder", () => {
    const builder = createFeedbackCsvBuilder({ lineDelimiter: "\n", includeBOM: true });
    builder.addRow(makeFlag());
    const output = builder.build();
    expect(output.startsWith("\uFEFF")).toBe(true);
    expect(output).toContain("\nVENUE,PENDING");
  });
});

describe("downloadFeedbackCSV", () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let clickSpy: jest.SpyInstance;
  let downloadedName: string;

  beforeEach(() => {
    createObjectURL = jest.fn(() => "blob:mock");
    revokeObjectURL = jest.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL =
      createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      revokeObjectURL;

    downloadedName = "";
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("names the file worksphere-feedback-<date>.csv by default", () => {
    downloadFeedbackCSV([makeFlag()]);

    expect(downloadedName).toMatch(
      /^worksphere-feedback-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("respects explicit string filename", () => {
    downloadFeedbackCSV([makeFlag()], "custom-export.csv");
    expect(downloadedName).toBe("custom-export.csv");
  });

  it("respects options object with filename property", () => {
    downloadFeedbackCSV([makeFlag()], { filename: "options-export.csv" });
    expect(downloadedName).toBe("options-export.csv");
  });

  it("handles null flags array in downloadFeedbackCSV safely", () => {
    downloadFeedbackCSV(null as any);
    expect(downloadedName).toMatch(/^worksphere-feedback-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
