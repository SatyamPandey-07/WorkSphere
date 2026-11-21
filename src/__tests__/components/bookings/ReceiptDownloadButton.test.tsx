import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ReceiptDownloadButton } from "@/components/bookings/ReceiptDownloadButton";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pdfResponse = () => ({
  ok: true,
  status: 200,
  blob: async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }),
});

describe("ReceiptDownloadButton (#7611)", () => {
  const originalFetch = global.fetch;
  let clickSpy: jest.SpyInstance;
  let downloadedAs: string[];

  beforeEach(() => {
    jest.useFakeTimers();
    downloadedAs = [];
    global.fetch = jest.fn();
    URL.createObjectURL = jest.fn(() => "blob:receipt");
    URL.revokeObjectURL = jest.fn();
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedAs.push(this.download);
      });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockToast.mockReset();
  });

  const button = () => screen.getByRole("button");

  it("renders an enabled Download receipt button when idle", () => {
    render(<ReceiptDownloadButton bookingId="b1" confirmationId="WS-1" />);

    expect(button()).toBeEnabled();
    expect(button()).toHaveAccessibleName("Download receipt");
    expect(button()).toHaveAttribute("aria-busy", "false");
    expect(
      screen.queryByTestId("receipt-download-spinner"),
    ).not.toBeInTheDocument();
  });

  it("is disabled with a spinner and pulse while the PDF is generated", async () => {
    const pending = deferred<ReturnType<typeof pdfResponse>>();
    (global.fetch as jest.Mock).mockReturnValue(pending.promise);
    render(<ReceiptDownloadButton bookingId="b1" confirmationId="WS-1" />);

    await act(async () => {
      fireEvent.click(button());
    });

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("aria-busy", "true");
    expect(button()).toHaveAccessibleName("Generating receipt");
    expect(button()).toHaveTextContent("Generating…");
    expect(button()).toHaveClass("animate-pulse");
    expect(screen.getByTestId("receipt-download-spinner")).toHaveClass(
      "animate-spin",
    );

    await act(async () => {
      pending.resolve(pdfResponse());
    });
  });

  it("sends only one request when clicked repeatedly during generation", async () => {
    const pending = deferred<ReturnType<typeof pdfResponse>>();
    (global.fetch as jest.Mock).mockReturnValue(pending.promise);
    render(<ReceiptDownloadButton bookingId="b1" />);

    await act(async () => {
      button().click();
      button().click();
      fireEvent.click(button());
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(pdfResponse());
    });
  });

  it("downloads the PDF with the receipt file name and restores the button", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(pdfResponse());
    render(<ReceiptDownloadButton bookingId="b 1" confirmationId="WS-42" />);

    await act(async () => {
      fireEvent.click(button());
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/bookings/b%201/download");
    expect(downloadedAs).toEqual(["WorkSphere_Receipt_WS-42.pdf"]);
    expect(button()).toBeEnabled();
    expect(button()).toHaveAccessibleName("Download receipt");
    expect(
      screen.queryByTestId("receipt-download-spinner"),
    ).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:receipt");
  });

  it("falls back to the booking id for the file name", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(pdfResponse());
    render(<ReceiptDownloadButton bookingId="b9" confirmationId={null} />);

    await act(async () => {
      fireEvent.click(button());
    });

    expect(downloadedAs).toEqual(["WorkSphere_Receipt_b9.pdf"]);
  });

  it.each([
    [
      "the server returns an error",
      () => Promise.resolve({ ok: false, status: 500 }),
    ],
    [
      "the request fails",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
  ])(
    "restores the button and shows a toast when %s",
    async (_label, respond) => {
      (global.fetch as jest.Mock).mockImplementation(respond);
      render(<ReceiptDownloadButton bookingId="b1" />);

      await act(async () => {
        fireEvent.click(button());
      });

      expect(button()).toBeEnabled();
      expect(button()).toHaveAttribute("aria-busy", "false");
      expect(clickSpy).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't download the receipt. Please try again.",
        "error",
      );
    },
  );
});
