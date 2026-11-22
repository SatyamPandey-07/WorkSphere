import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";

// Mock minimal page navigation/routing scenario
function MockAppShell({ currentRoute = "/" }: { currentRoute?: string }) {
  return (
    <div>
      <header>
        <nav aria-label="Main Navigation">
          <a href="/">Home</a>
          <a href="/venues">Venues</a>
          <a href="/bookings">Bookings</a>
        </nav>
      </header>
      <main id="main-content">
        {currentRoute === "/" && (
          <div data-testid="home-page">
            <h1>Welcome to WorkSphere</h1>
            <button data-testid="explore-btn">Explore Workspaces</button>
          </div>
        )}
        {currentRoute === "/venues" && (
          <div data-testid="venues-page">
            <h1>Venue Search</h1>
            <input aria-label="Filter venues" data-testid="venue-filter" />
          </div>
        )}
      </main>
      {/* Root mounted KeyboardShortcutsModal exactly as integrated in layout.tsx */}
      <KeyboardShortcutsModal />
    </div>
  );
}

describe("KeyboardShortcutsModal Application Root Integration", () => {
  it("mounts at the application level and is initially hidden", () => {
    render(<MockAppShell currentRoute="/" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the modal cheat sheet when '?' is pressed anywhere on an application page", () => {
    render(<MockAppShell currentRoute="/" />);

    act(() => {
      fireEvent.keyDown(window, { key: "?" });
    });

    const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Book seat")).toBeInTheDocument();
    expect(screen.getByText("Favorite")).toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
  });

  it("maintains global shortcut functionality across simulated route navigation", () => {
    const { rerender } = render(<MockAppShell currentRoute="/" />);

    // Trigger on Home page
    act(() => {
      fireEvent.keyDown(window, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Close on Escape
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Navigate to /venues
    rerender(<MockAppShell currentRoute="/venues" />);
    expect(screen.getByTestId("venues-page")).toBeInTheDocument();

    // Trigger on /venues page
    act(() => {
      fireEvent.keyDown(window, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not intercept '?' when user is typing in form controls on routed pages", () => {
    render(<MockAppShell currentRoute="/venues" />);

    const filterInput = screen.getByTestId("venue-filter");
    filterInput.focus();

    act(() => {
      fireEvent.keyDown(filterInput, { key: "?" });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ensures only a single modal instance is mounted and unmounting cleans up the listener", () => {
    const { unmount } = render(<MockAppShell currentRoute="/" />);

    act(() => {
      fireEvent.keyDown(window, { key: "?" });
    });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    // Unmount app shell
    unmount();

    // Verify key events no longer trigger errors or ghost dialogs
    expect(() => {
      act(() => {
        fireEvent.keyDown(window, { key: "?" });
      });
    }).not.toThrow();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
