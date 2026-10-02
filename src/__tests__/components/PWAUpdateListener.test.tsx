import { render, act } from "@testing-library/react";
import { PWAUpdateListener } from "@/components/PWAUpdateListener";

// Mock useToast
const toastMock = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("PWAUpdateListener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing (no visible UI)", () => {
    const { container } = render(<PWAUpdateListener />);
    expect(container.firstChild).toBeNull();
  });

  it("shows toast when 'pwa-update-available' event fires", () => {
    render(<PWAUpdateListener />);

    act(() => {
      window.dispatchEvent(new CustomEvent("pwa-update-available"));
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining("version"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not crash on unmount", () => {
    const { unmount } = render(<PWAUpdateListener />);
    expect(() => unmount()).not.toThrow();
  });
});
