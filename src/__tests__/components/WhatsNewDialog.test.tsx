import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
