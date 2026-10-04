import { render, screen } from "@testing-library/react";
import { TimezoneBadge, getUserTimezone } from "@/components/TimezoneBadge";

const mockIntl = (resolved: () => unknown) =>
  jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(
      () => ({ resolvedOptions: resolved }) as unknown as Intl.DateTimeFormat,
    );

describe("getUserTimezone", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the detected IANA timezone", () => {
    mockIntl(() => ({ timeZone: "Asia/Kolkata" }));
    expect(getUserTimezone()).toBe("Asia/Kolkata");
  });

  it("falls back to UTC when timeZone is undefined", () => {
    mockIntl(() => ({ timeZone: undefined }));
    expect(getUserTimezone()).toBe("UTC");
  });

  it("falls back to UTC when Intl throws", () => {
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });
    expect(getUserTimezone()).toBe("UTC");
  });
});

describe("TimezoneBadge", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the detected timezone and a copy button", () => {
    mockIntl(() => ({ timeZone: "America/New_York" }));
    render(<TimezoneBadge />);
    expect(screen.getByTestId("timezone-value").textContent).toBe(
      "America/New_York",
    );
    expect(
      screen.getByRole("button", { name: /copy to clipboard/i }),
    ).toBeTruthy();
  });

  it("shows UTC when the Intl API returns undefined", () => {
    mockIntl(() => ({ timeZone: undefined }));
    render(<TimezoneBadge />);
    expect(screen.getByTestId("timezone-value").textContent).toBe("UTC");
  });
});
