import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AccessibleMarker } from "@/components/ui/MapMarker";

// Mock react-leaflet Marker and Popup
const mockOpenPopup = jest.fn();
const mockClosePopup = jest.fn();

jest.mock("react-leaflet", () => {
  return {
    Marker: React.forwardRef(function MockMarker(
      { children, position, icon, eventHandlers }: any,
      ref: any
    ) {
      const elRef = React.useRef<HTMLDivElement>(null);

      // Expose imperative Leaflet marker API via ref
      React.useImperativeHandle(ref, () => ({
        getElement: () => elRef.current,
        getLatLng: () => ({ lat: position[0], lng: position[1] }),
        setLatLng: jest.fn(),
        setIcon: jest.fn(),
        openPopup: mockOpenPopup,
        closePopup: mockClosePopup,
      }));

      React.useEffect(() => {
        if (eventHandlers?.add && elRef.current) {
          eventHandlers.add({
            target: {
              getElement: () => elRef.current,
              getPopup: () => null,
            },
          });
        }
      }, [eventHandlers]);

      return (
        <div
          ref={elRef}
          data-testid="accessible-marker"
          data-icon={icon}
          onClick={eventHandlers?.click}
          onKeyDown={(e) => {
            if (eventHandlers?.keydown) {
              const mockOriginalEvent = {
                key: e.key,
                preventDefault: jest.fn(),
              };
              eventHandlers.keydown({
                originalEvent: mockOriginalEvent,
                target: {
                  openPopup: mockOpenPopup,
                  closePopup: mockClosePopup,
                },
              });
            }
          }}
        >
          {children}
        </div>
      );
    }),
    Popup: ({ children }: any) => <div data-testid="marker-popup">{children}</div>,
  };
});

describe("AccessibleMarker Accessibility & Keyboard Interactions", () => {
  const dummyIcon = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("applies tabIndex={0}, role='button', and interactive-map-pin class", () => {
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
        category="cafe"
        rating={4.8}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    expect(marker).toHaveAttribute("tabindex", "0");
    expect(marker).toHaveAttribute("role", "button");
    expect(marker).toHaveClass("interactive-map-pin");
  });

  it("formats descriptive aria-label with Venue name, Category, and Rating", () => {
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Capital One Cafe"
        category="coworking"
        rating={4.5}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    expect(marker).toHaveAttribute(
      "aria-label",
      "Venue: Capital One Cafe, coworking, Rating: 4.5"
    );
  });

  it("formats destination markers with Destination: {name}", () => {
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Union Square"
        isDestination={true}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    expect(marker).toHaveAttribute("aria-label", "Destination: Union Square");
  });

  it("triggers openPopup and onClick on Enter key press", () => {
    const onClick = jest.fn();
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
        onClick={onClick}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    fireEvent.keyDown(marker, { key: "Enter" });

    expect(mockOpenPopup).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("triggers openPopup and onClick on Space key press", () => {
    const onClick = jest.fn();
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
        onClick={onClick}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    fireEvent.keyDown(marker, { key: " " });

    expect(mockOpenPopup).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("triggers closePopup on Escape key press", () => {
    render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    fireEvent.keyDown(marker, { key: "Escape" });

    expect(mockClosePopup).toHaveBeenCalledTimes(1);
  });

  it("updates aria-label dynamically when props change", () => {
    const { rerender } = render(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
        rating={4.2}
      />
    );

    const marker = screen.getByTestId("accessible-marker");
    expect(marker).toHaveAttribute(
      "aria-label",
      "Venue: Blue Bottle Coffee, Rating: 4.2"
    );

    rerender(
      <AccessibleMarker
        position={[37.7749, -122.4194]}
        icon={dummyIcon}
        name="Blue Bottle Coffee"
        category="cafe"
        rating={4.9}
      />
    );

    expect(marker).toHaveAttribute(
      "aria-label",
      "Venue: Blue Bottle Coffee, cafe, Rating: 4.9"
    );
  });
});
