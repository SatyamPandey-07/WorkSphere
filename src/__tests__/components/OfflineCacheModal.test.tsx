import { render, screen, fireEvent } from "@testing-library/react";
import { OfflineCacheModal } from "@/components/OfflineCacheModal";

// Mock getAllVenuesOffline
jest.mock("@/lib/offlineStorage", () => ({
  getAllVenuesOffline: jest.fn().mockResolvedValue([
    { id: "v1", name: "Café A" },
    { id: "v2", name: "Café B" },
  ]),
}));

// Mock navigator.storage.estimate
Object.defineProperty(navigator, "storage", {
  value: {
    estimate: jest.fn().mockResolvedValue({ usage: 1024 * 1024, quota: 50 * 1024 * 1024 }),
  },
  writable: true,
  configurable: true,
});

describe("OfflineCacheModal", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <OfflineCacheModal isOpen={false} onClose={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Offline Cache' heading when isOpen=true", async () => {
    render(<OfflineCacheModal isOpen onClose={jest.fn()} />);
    expect(await screen.findByText("Offline Cache")).toBeInTheDocument();
  });

  it("has role='dialog' and aria-modal", async () => {
    const { container } = render(
      <OfflineCacheModal isOpen onClose={jest.fn()} />,
    );
    await screen.findByText("Offline Cache");
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
  });

  it("renders a 'Clear Offline Cache' button when loaded", async () => {
    render(<OfflineCacheModal isOpen onClose={jest.fn()} />);
    const clearBtn = await screen.findByText(/clear offline cache/i);
    expect(clearBtn).toBeInTheDocument();
  });

  it("shows confirmation dialog when Clear Cache is clicked", async () => {
    render(<OfflineCacheModal isOpen onClose={jest.fn()} />);
    const clearBtn = await screen.findByText(/clear offline cache/i);
    fireEvent.click(clearBtn);
    expect(await screen.findByText(/clear all/i)).toBeInTheDocument();
  });

  it("renders the Close button", async () => {
    render(<OfflineCacheModal isOpen onClose={jest.fn()} />);
    await screen.findByText("Offline Cache");
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = jest.fn();
    render(<OfflineCacheModal isOpen onClose={onClose} />);
    await screen.findByText("Offline Cache");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
