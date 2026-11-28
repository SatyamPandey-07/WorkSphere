import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsNewDialog } from "@/components/releases/WhatsNewDialog";

const releasePayload = {
  web: {
    version: "2.5.0",
    tag: "v2.5.0",
    notesSummary: "A faster dashboard and improved booking tools.",
    prerelease: false,
    publishedAt: "2026-03-15T12:00:00.000Z",
    url: "https://github.com/srnsksyp/WorkSphere/releases/tag/v2.5.0",
    downloads: [
      {
        name: "worksphere-web-v2.5.0.tar.gz",
        url: "https://example.com/worksphere-web-v2.5.0.tar.gz",
        size: 2048,
      },
    ],
  },
  flutter: null,
};

describe("WhatsNewDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows a newer release and renders its notes and release information", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("WorkSphere 2.5.0")).toBeInTheDocument();
    expect(
      screen.getByText("A faster dashboard and improved booking tools."),
    ).toBeInTheDocument();
    expect(screen.getByText("Release tag: v2.5.0")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Full release notes" }),
    ).toHaveAttribute("href", releasePayload.web.url);
    expect(
      screen.getByRole("link", {
        name: "Download worksphere-web-v2.5.0.tar.gz",
      }),
    ).toHaveAttribute("href", releasePayload.web.downloads[0].url);
  });

  it("does not show a release version already stored as last seen", async () => {
    window.localStorage.setItem("worksphere:last-seen-release-version", "2.5.0");
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/releases/latest",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the release when the last-seen storage value contains malformed JSON", async () => {
    window.localStorage.setItem(
      "worksphere:last-seen-release-version",
      "{malformed-json",
    );
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("WorkSphere 2.5.0")).toBeInTheDocument();
  });

  it("continues to show the release when localStorage reads throw", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("WorkSphere 2.5.0")).toBeInTheDocument();
  });

  it("persists the current release version when dismissed", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));

    expect(window.localStorage.getItem("worksphere:last-seen-release-version"))
      .toBe("2.5.0");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses with Escape and persists the release version", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    expect(window.localStorage.getItem("worksphere:last-seen-release-version"))
      .toBe("2.5.0");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render a dialog when the API returns an error", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);
    render(
      <main>
        <h1>Dashboard</h1>
        <WhatsNewDialog />
      </main>,
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render a dialog when release data is missing", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ web: null }),
    } as Response);
    render(
      <main>
        <h1>Dashboard</h1>
        <WhatsNewDialog />
      </main>,
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("copies the release tag and shows accessible confirmation state", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);
    const copyTagButton = await screen.findByRole("button", {
      name: "Copy release tag v2.5.0",
    });

    fireEvent.click(copyTagButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("v2.5.0");
      expect(
        screen.getByRole("button", { name: "Copied release tag v2.5.0" }),
      ).toHaveTextContent("Copied tag");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied release tag v2.5.0",
    );
  });

  it("copies the SHA-256 verification command and resets confirmation state after timeout", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    render(<WhatsNewDialog />);
    const copyCommandButton = await screen.findByRole("button", {
      name: "Copy SHA-256 verification command",
    });

    fireEvent.click(copyCommandButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("sha256sum -c SHA256SUMS.txt");
      expect(
        screen.getByRole("button", {
          name: "Copied SHA-256 verification command",
        }),
      ).toHaveTextContent("Copied command");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied SHA-256 verification command",
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(
      screen.getByRole("button", { name: "Copy SHA-256 verification command" }),
    ).toHaveTextContent("Copy SHA-256 command");
  });

  it("restores focus and preserves Escape handling after successful clipboard fallback", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    const execCommandMock = jest.fn().mockReturnValue(true);

    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    try {
      render(<WhatsNewDialog />);
      const copyTagButton = await screen.findByRole("button", {
        name: "Copy release tag v2.5.0",
      });

      copyTagButton.focus();
      expect(document.activeElement).toBe(copyTagButton);

      fireEvent.click(copyTagButton);

      await waitFor(() => {
        expect(execCommandMock).toHaveBeenCalledWith("copy");
        expect(
          screen.getByRole("button", { name: "Copied release tag v2.5.0" }),
        ).toHaveTextContent("Copied tag");
      });
      expect(document.activeElement).toBe(copyTagButton);

      fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
      if (originalExecCommand) {
        Object.defineProperty(document, "execCommand", originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it("restores focus and preserves Escape handling when clipboard fallback fails", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    const writeText = jest.fn().mockRejectedValue(new Error("Denied"));
    const execCommandMock = jest.fn().mockReturnValue(false);

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => releasePayload,
    } as Response);

    try {
      render(<WhatsNewDialog />);
      const copyCommandButton = await screen.findByRole("button", {
        name: "Copy SHA-256 verification command",
      });

      copyCommandButton.focus();
      expect(document.activeElement).toBe(copyCommandButton);

      fireEvent.click(copyCommandButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("sha256sum -c SHA256SUMS.txt");
        expect(execCommandMock).toHaveBeenCalledWith("copy");
      });
      expect(
        screen.getByRole("button", { name: "Copy SHA-256 verification command" }),
      ).toHaveTextContent("Copy SHA-256 command");
      expect(document.activeElement).toBe(copyCommandButton);

      fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      }
      if (originalExecCommand) {
        Object.defineProperty(document, "execCommand", originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });
});
