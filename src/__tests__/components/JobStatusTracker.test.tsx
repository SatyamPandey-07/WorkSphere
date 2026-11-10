import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { JobStatusTracker } from "@/components/JobStatusTracker";

describe("JobStatusTracker Component (#6925)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("returns null when jobId is empty or whitespace-only", () => {
    const { container } = render(<JobStatusTracker jobId="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("renders initial queued state and polls on mount", async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      new Promise(() => {}) // pending promise
    );

    render(<JobStatusTracker jobId="job-101" />);

    const container = screen.getByTestId("job-status-tracker");
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute("role", "status");
    expect(screen.getByTestId("job-status-queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting in queue...")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/jobs/job-101");
  });

  it("transitions to PROCESSING when API returns status PROCESSING", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "PROCESSING" }),
    });

    render(<JobStatusTracker jobId="job-102" />);

    // Fast-forward initial resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("job-status-processing")).toBeInTheDocument();
    expect(
      screen.getByText("Generating PDF and uploading to Cloudinary...")
    ).toBeInTheDocument();
  });

  it("transitions to COMPLETED, renders download button, and calls onCompleted", async () => {
    const handleCompleted = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETED",
        resultUrl: "https://cloudinary.com/test-doc.pdf",
      }),
    });

    render(
      <JobStatusTracker
        jobId="job-103"
        onCompleted={handleCompleted}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("job-status-completed")).toBeInTheDocument();
    expect(screen.getByText("Your PDF is ready!")).toBeInTheDocument();

    const downloadBtn = screen.getByTestId("job-download-btn");
    expect(downloadBtn).toHaveAttribute(
      "href",
      "https://cloudinary.com/test-doc.pdf"
    );
    expect(downloadBtn).toHaveAttribute("target", "_blank");
    expect(downloadBtn).toHaveAttribute("rel", "noreferrer");

    expect(handleCompleted).toHaveBeenCalledWith(
      "https://cloudinary.com/test-doc.pdf"
    );
  });

  it("transitions to FAILED, renders error message, and calls onFailed", async () => {
    const handleFailed = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "FAILED",
        error: "Generation timeout exceeded",
      }),
    });

    render(
      <JobStatusTracker
        jobId="job-104"
        onFailed={handleFailed}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("job-status-failed")).toBeInTheDocument();
    expect(screen.getByText("Failed to generate PDF.")).toBeInTheDocument();
    expect(screen.getByTestId("job-error-msg")).toHaveTextContent(
      "Generation timeout exceeded"
    );
    expect(handleFailed).toHaveBeenCalledWith("Generation timeout exceeded");
  });

  it("polls periodically using custom pollIntervalMs until terminal state", async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ status: "QUEUED" }),
        };
      } else if (callCount === 2) {
        return {
          ok: true,
          json: async () => ({ status: "PROCESSING" }),
        };
      } else {
        return {
          ok: true,
          json: async () => ({
            status: "COMPLETED",
            resultUrl: "https://example.com/res.pdf",
          }),
        };
      }
    });

    render(<JobStatusTracker jobId="job-105" pollIntervalMs={500} />);

    // First call (mount)
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("job-status-queued")).toBeInTheDocument();

    // Advance 500ms for second call
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(screen.getByTestId("job-status-processing")).toBeInTheDocument();

    // Advance 500ms for third call
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(screen.getByTestId("job-status-completed")).toBeInTheDocument();

    // Additional timer advance should not trigger further fetch because interval was cleared
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(callCount).toBe(3);
  });

  it("handles non-ok HTTP responses and network rejections gracefully", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network disconnect"));

    render(<JobStatusTracker jobId="job-106" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Should remain in QUEUED state without throwing unhandled rejection
    expect(screen.getByTestId("job-status-queued")).toBeInTheDocument();
  });

  it("handles unmount during in-flight fetch safely", async () => {
    let resolvePromise: (value: any) => void;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { unmount } = render(<JobStatusTracker jobId="job-107" />);

    unmount();

    // Resolving after unmount should not throw or cause warning
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: async () => ({ status: "COMPLETED", resultUrl: "https://test.pdf" }),
      });
      await Promise.resolve();
    });
  });

  it("applies custom className and testId to the root container", () => {
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));

    render(
      <JobStatusTracker
        jobId="job-108"
        className="my-custom-tracker-class"
        testId="custom-tracker-id"
      />
    );

    const container = screen.getByTestId("custom-tracker-id");
    expect(container).toHaveClass("my-custom-tracker-class");
  });
});
