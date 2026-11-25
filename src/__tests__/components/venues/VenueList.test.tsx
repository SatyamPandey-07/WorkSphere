import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import VenueListDefault, {
  VenueList,
  isVenueCurrentlyOpen,
} from "@/components/venues/VenueList";
import { useKeyboardNavigation, isEditableElement } from "@/hooks/useKeyboardNavigation";
import { renderHook } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("@/components/VenueCard", () => ({
  VenueCard: ({ venue, onSaveFavorite }: any) => (
    <div data-testid={`mock-venue-card-${venue.id || venue.placeId}`}>
      <span>{venue.name}</span>
      {onSaveFavorite && (
        <button
          data-testid={`bookmark-btn-${venue.id || venue.placeId}`}
          onClick={() => onSaveFavorite({ id: venue.id || venue.placeId })}
        >
          Bookmark
        </button>
      )}
    </div>
  ),
}));

describe("VenueList Component Suite", () => {
  const sampleVenues = [
    {
      id: "venue-1",
      name: "Downtown Cafe",
      latitude: 37.7749,
      longitude: -122.4194,
      openNow: true,
    },
    {
      id: "venue-2",
      name: "Uptown Workspace",
      latitude: 37.7849,
      longitude: -122.4094,
      openNow: false,
    },
    {
      id: "venue-3",
      name: "Midtown Studio",
      lat: 37.7949,
      lng: -122.3994,
      openNow: true,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports default component matching named export", () => {
    expect(VenueListDefault).toBe(VenueList);
  });

  describe("Defensive Null / Undefined Guards", () => {
    it("handles omitted venues without throwing and displays empty fallback", () => {
      render(<VenueList />);

      expect(screen.getByTestId("venue-list")).toBeInTheDocument();
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();
      expect(screen.getByTestId("venue-list-empty")).toHaveTextContent(
        "No venues found matching your distance and location criteria."
      );
    });

    it("handles undefined and null venues without throwing", () => {
      const { rerender } = render(<VenueList venues={undefined} />);
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();

      rerender(<VenueList venues={null as any} />);
      expect(screen.getByTestId("venue-list-empty")).toBeInTheDocument();
    });
  });

  describe("Venue Grid & Filters", () => {
    it("renders venue cards in responsive grid", () => {
      render(<VenueList venues={sampleVenues} />);

      expect(screen.getByTestId("venue-list-grid")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-3")).toBeInTheDocument();
    });

    it("toggles 'Open Now' filter chip and updates list", () => {
      render(<VenueList venues={sampleVenues} />);

      const filterBtn = screen.getByTestId("open-now-filter-chip");
      expect(filterBtn).toBeInTheDocument();
      expect(filterBtn).toHaveAttribute("aria-pressed", "false");

      // Click Open Now filter
      fireEvent.click(filterBtn);
      expect(filterBtn).toHaveAttribute("aria-pressed", "true");

      // Closed venue-2 should be filtered out
      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-venue-card-venue-2")).not.toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-3")).toBeInTheDocument();

      // Click again to deactivate filter
      fireEvent.click(filterBtn);
      expect(filterBtn).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
    });

    it("displays appropriate empty message when Open Now yields zero results", () => {
      const closedVenues = [
        { id: "v-closed", name: "Closed Spot", openNow: false },
      ];
      render(<VenueList venues={closedVenues} />);

      fireEvent.click(screen.getByTestId("open-now-filter-chip"));

      expect(screen.getByTestId("venue-list-empty")).toHaveTextContent(
        "No venues currently open matching your criteria."
      );
    });

    it("hides Open Now filter chip when showOpenNowFilter is false", () => {
      render(<VenueList venues={sampleVenues} showOpenNowFilter={false} />);

      expect(screen.queryByTestId("open-now-filter-chip")).not.toBeInTheDocument();
    });
  });

  describe("Distance & Proximity", () => {
    const userLocation = { lat: 37.7749, lng: -122.4194 };

    it("renders distance badge and sr-only walking badge when userLocation is supplied", () => {
      render(<VenueList venues={sampleVenues} userLocation={userLocation} />);

      const badge1 = screen.getByTestId("distance-badge-venue-1");
      expect(badge1).toBeInTheDocument();
      expect(badge1).toHaveTextContent("0.0 km away");

      const walking1 = screen.getByTestId("walking-badge-venue-1");
      expect(walking1).toBeInTheDocument();
    });

    it("filters venues within maxDistanceKm radius", () => {
      render(
        <VenueList
          venues={sampleVenues}
          userLocation={userLocation}
          maxDistanceKm={2.0}
        />
      );

      expect(screen.getByTestId("mock-venue-card-venue-1")).toBeInTheDocument();
      expect(screen.getByTestId("mock-venue-card-venue-2")).toBeInTheDocument();
      expect(screen.queryByTestId("mock-venue-card-venue-3")).not.toBeInTheDocument();
    });

    it("sorts venues by proximity when sortByProximity is enabled", () => {
      const farLocation = { lat: 37.7949, lng: -122.3994 };
      render(
        <VenueList
          venues={sampleVenues}
          userLocation={farLocation}
          sortByProximity={true}
        />
      );

      const cards = screen.getAllByTestId(/mock-venue-card-/);
      expect(cards[0]).toHaveTextContent("Midtown Studio"); // closest
    });
  });

  describe("Bookmark Callback & Custom Styling", () => {
    it("invokes onBookmarkToggle callback when bookmark is clicked", () => {
      const handleBookmark = jest.fn();
      render(
        <VenueList venues={sampleVenues} onBookmarkToggle={handleBookmark} />
      );

      const bookmarkBtn = screen.getByTestId("bookmark-btn-venue-1");
      fireEvent.click(bookmarkBtn);

      expect(handleBookmark).toHaveBeenCalledWith("venue-1");
    });

    it("applies custom className and data-testid overrides", () => {
      render(
        <VenueList
          venues={sampleVenues}
          className="custom-grid-style"
          data-testid="custom-venue-list-root"
        />
      );

      expect(screen.getByTestId("custom-venue-list-root")).toBeInTheDocument();
      const grid = screen.getByTestId("venue-list-grid");
      expect(grid.className).toContain("custom-grid-style");
    });
  });

  describe("isVenueCurrentlyOpen Helper", () => {
    it("returns false for falsy venue", () => {
      expect(isVenueCurrentlyOpen(null)).toBe(false);
      expect(isVenueCurrentlyOpen(undefined)).toBe(false);
    });

    it("returns explicit boolean status if present", () => {
      expect(isVenueCurrentlyOpen({ openNow: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ openNow: false })).toBe(false);
      expect(isVenueCurrentlyOpen({ isOpen: true })).toBe(true);
      expect(isVenueCurrentlyOpen({ isOpen: false })).toBe(false);
    });
  });

  describe("Keyboard Shortcut Navigation (j/k, Enter, Space)", () => {
    it("selects next venue on 'j' and wraps around to the beginning", () => {
      render(<VenueList venues={sampleVenues} />);

      const wrapper0 = screen.getByTestId("venue-card-wrapper-venue-1");
      const wrapper1 = screen.getByTestId("venue-card-wrapper-venue-2");
      const wrapper2 = screen.getByTestId("venue-card-wrapper-venue-3");

      // Initially no active card
      expect(wrapper0).toHaveAttribute("data-active", "false");

      // Press 'j' -> moves to first venue (index 0)
      fireEvent.keyDown(window, { key: "j" });
      expect(wrapper0).toHaveAttribute("data-active", "true");
      expect(wrapper0).toHaveAttribute("aria-current", "true");
      expect(wrapper1).toHaveAttribute("data-active", "false");

      // Press 'j' -> moves to second venue (index 1)
      fireEvent.keyDown(window, { key: "j" });
      expect(wrapper1).toHaveAttribute("data-active", "true");
      expect(wrapper0).toHaveAttribute("data-active", "false");

      // Press 'j' -> moves to third venue (index 2)
      fireEvent.keyDown(window, { key: "j" });
      expect(wrapper2).toHaveAttribute("data-active", "true");

      // Press 'j' at boundary -> wraps around to index 0
      fireEvent.keyDown(window, { key: "j" });
      expect(wrapper0).toHaveAttribute("data-active", "true");
      expect(wrapper2).toHaveAttribute("data-active", "false");
    });

    it("selects previous venue on 'k' and wraps around to the last venue", () => {
      render(<VenueList venues={sampleVenues} />);

      const wrapper0 = screen.getByTestId("venue-card-wrapper-venue-1");
      const wrapper2 = screen.getByTestId("venue-card-wrapper-venue-3");

      // Press 'k' when unselected -> wraps to the last venue (index 2)
      fireEvent.keyDown(window, { key: "k" });
      expect(wrapper2).toHaveAttribute("data-active", "true");

      // Press 'k' -> moves to index 1
      fireEvent.keyDown(window, { key: "k" });
      const wrapper1 = screen.getByTestId("venue-card-wrapper-venue-2");
      expect(wrapper1).toHaveAttribute("data-active", "true");

      // Press 'k' -> moves to index 0
      fireEvent.keyDown(window, { key: "k" });
      expect(wrapper0).toHaveAttribute("data-active", "true");

      // Press 'k' at index 0 -> wraps around to last venue (index 2)
      fireEvent.keyDown(window, { key: "k" });
      expect(wrapper2).toHaveAttribute("data-active", "true");
    });

    it("activates selected venue on 'Enter' and navigates via router or callback", () => {
      const handleSelect = jest.fn();
      render(<VenueList venues={sampleVenues} onSelectVenue={handleSelect} />);

      // Select first venue
      fireEvent.keyDown(window, { key: "j" });
      // Press Enter
      fireEvent.keyDown(window, { key: "Enter" });

      expect(handleSelect).toHaveBeenCalledWith(sampleVenues[0], 0);
    });

    it("activates selected venue on 'Space' without unintended default scrolling", () => {
      render(<VenueList venues={sampleVenues} />);

      // Select second venue
      fireEvent.keyDown(window, { key: "j" });
      fireEvent.keyDown(window, { key: "j" });

      const spaceEvent = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = jest.spyOn(spaceEvent, "preventDefault");
      window.dispatchEvent(spaceEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/venues/venue-2");
    });

    it("does not navigate on Enter/Space if no venue is selected", () => {
      const handleSelect = jest.fn();
      render(<VenueList venues={sampleVenues} onSelectVenue={handleSelect} />);

      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.keyDown(window, { key: " " });

      expect(handleSelect).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("ignores shortcuts when focus is inside text input, textarea, or contenteditable", () => {
      render(
        <div>
          <input data-testid="test-input" type="text" />
          <textarea data-testid="test-textarea" />
          <div data-testid="test-editable" contentEditable="true" />
          <VenueList venues={sampleVenues} />
        </div>
      );

      const input = screen.getByTestId("test-input");
      const textarea = screen.getByTestId("test-textarea");
      const editable = screen.getByTestId("test-editable");

      const wrapper0 = screen.getByTestId("venue-card-wrapper-venue-1");

      // Focus input and press 'j'
      input.focus();
      fireEvent.keyDown(input, { key: "j" });
      expect(wrapper0).toHaveAttribute("data-active", "false");

      // Focus textarea and press 'j'
      textarea.focus();
      fireEvent.keyDown(textarea, { key: "j" });
      expect(wrapper0).toHaveAttribute("data-active", "false");

      // Focus contenteditable and press 'j'
      editable.focus();
      fireEvent.keyDown(editable, { key: "j" });
      expect(wrapper0).toHaveAttribute("data-active", "false");
    });

    it("safely does nothing when list is empty", () => {
      render(<VenueList venues={[]} />);

      // Should not throw
      expect(() => {
        fireEvent.keyDown(window, { key: "j" });
        fireEvent.keyDown(window, { key: "k" });
        fireEvent.keyDown(window, { key: "Enter" });
        fireEvent.keyDown(window, { key: " " });
      }).not.toThrow();

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("resets or bounds activeIndex when venues list shrinks or filters change", () => {
      const { rerender } = render(<VenueList venues={sampleVenues} />);

      // Select last venue (index 2)
      fireEvent.keyDown(window, { key: "k" });
      expect(screen.getByTestId("venue-card-wrapper-venue-3")).toHaveAttribute(
        "data-active",
        "true"
      );

      // Rerender with only 1 venue
      rerender(<VenueList venues={[sampleVenues[0]]} />);

      // Active index should be clamped to 0 (the only remaining venue)
      expect(screen.getByTestId("venue-card-wrapper-venue-1")).toHaveAttribute(
        "data-active",
        "true"
      );
    });

    it("cleans up event listeners on unmount", () => {
      const removeListenerSpy = jest.spyOn(window, "removeEventListener");
      const { unmount } = render(<VenueList venues={sampleVenues} />);

      unmount();

      expect(removeListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function)
      );
    });
  });

  describe("useKeyboardNavigation hook directly", () => {
    it("supports non-wrap boundary behavior when wrapAround is false", () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({
          items: ["a", "b", "c"],
          wrapAround: false,
        })
      );

      // Start at -1, selectNext -> 0
      act(() => {
        result.current.selectNext();
      });
      expect(result.current.activeIndex).toBe(0);

      // selectPrevious at 0 -> stays at 0 (wrapAround: false)
      act(() => {
        result.current.selectPrevious();
      });
      expect(result.current.activeIndex).toBe(0);

      // Next to 1, then 2
      act(() => {
        result.current.selectNext();
        result.current.selectNext();
      });
      expect(result.current.activeIndex).toBe(2);

      // Next at last item -> stays at 2 (wrapAround: false)
      act(() => {
        result.current.selectNext();
      });
      expect(result.current.activeIndex).toBe(2);
    });

    it("isEditableElement returns true for input, textarea, select, contenteditable, role=textbox", () => {
      const input = document.createElement("input");
      const textarea = document.createElement("textarea");
      const select = document.createElement("select");
      const divEditable = document.createElement("div");
      divEditable.setAttribute("contenteditable", "true");
      const divRole = document.createElement("div");
      divRole.setAttribute("role", "textbox");
      const plainDiv = document.createElement("div");

      expect(isEditableElement(input)).toBe(true);
      expect(isEditableElement(textarea)).toBe(true);
      expect(isEditableElement(select)).toBe(true);
      expect(isEditableElement(divEditable)).toBe(true);
      expect(isEditableElement(divRole)).toBe(true);
      expect(isEditableElement(plainDiv)).toBe(false);
      expect(isEditableElement(null)).toBe(false);
    });
  });
});
