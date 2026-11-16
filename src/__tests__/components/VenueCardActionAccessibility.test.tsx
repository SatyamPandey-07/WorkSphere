import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueCard } from "@/components/VenueCard";
import { VenueCard as CompactVenueCard } from "@/components/venue/VenueCard";
import { AmbientSoundPlayer } from "@/components/noise/AmbientSoundPlayer";
import { VenueShareButton } from "@/components/social/VenueShareButton";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn() }),
}));

// Load next/dynamic components through React.lazy so they resolve inside the
// test environment (the card loads the audio guide this way).
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: (
    loader: () => Promise<{ default: React.ComponentType<unknown> }>,
  ) => {
    const Lazy = React.lazy(loader);
    const Loaded = (props: Record<string, unknown>) => (
      <React.Suspense fallback={null}>
        <Lazy {...props} />
      </React.Suspense>
    );
    return Loaded;
  },
}));

// The card opens a live seat-availability socket; keep the test offline, as the
// VenueCard snapshot test does.
jest.mock("@/hooks/useSeatAvailability", () => ({
  useSeatAvailability: () => ({ availability: {} }),
}));

// The noise chart fetches data after mount; it is not part of what is tested.
jest.mock("@/components/noise/NoiseTimeChart", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ currency: "USD", setCurrency: jest.fn() }),
}));

const RING_CLASSES = [
  "focus-visible:ring-2",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-blue-500",
];

const venue = {
  id: "v-7941",
  name: "Blue Bottle Coffee",
  category: "cafe",
  address: "66 Mint St",
  rating: 4.6,
  position: { lat: 37.7749, lng: -122.4194 },
  noiseLevel: "quiet",
};

async function runAxe(container: HTMLElement) {
  const axe = await import("axe-core");
  // jsdom cannot compute colours, so contrast is checked by hand, not here.
  return axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
}

describe("VenueCard action controls: labels, focus rings and keyboard (#7941)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/venues/enrich")) {
        return {
          ok: true,
          json: async () => ({
            found: true,
            venueId: "v-7941",
            website: "https://bluebottlecoffee.com",
            price: 12,
          }),
        } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }) as jest.Mock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function renderMainCard() {
    const onGetDirections = jest.fn();
    const onRate = jest.fn();
    const utils = render(
      <VenueCard
        venue={venue}
        onGetDirections={onGetDirections}
        onRate={onRate}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", {
          name: /visit the website of blue bottle coffee/i,
        }),
      ).toBeInTheDocument(),
    );
    return { ...utils, onGetDirections, onRate };
  }

  describe("main card", () => {
    it("has no axe violations once the venue details have loaded", async () => {
      const { container } = await renderMainCard();
      const results = await runAxe(container);
      expect(results.violations).toEqual([]);
    });

    it.each([
      ["button", "Add Blue Bottle Coffee to favorites"],
      ["button", "Directions to Blue Bottle Coffee"],
      ["button", "Rate Blue Bottle Coffee"],
      ["button", "Add Blue Bottle Coffee to a collection"],
      ["button", "Share Blue Bottle Coffee"],
      ["link", "Visit the website of Blue Bottle Coffee (opens in a new tab)"],
    ] as const)("names the %s %p with the venue", async (role, name) => {
      await renderMainCard();
      expect(screen.getByRole(role, { name })).toBeInTheDocument();
    });

    it("keeps the visible label at the start of each accessible name", async () => {
      await renderMainCard();
      // WCAG 2.5.3: a voice-control user says what they see on the button.
      expect(
        screen.getByRole("button", { name: /^Directions/ }),
      ).toHaveTextContent("Directions");
      expect(screen.getByRole("button", { name: /^Rate/ })).toHaveTextContent(
        "Rate",
      );
    });

    it("shows the same visible focus ring on every action control", async () => {
      await renderMainCard();
      const controls = [
        screen.getByRole("button", {
          name: "Add Blue Bottle Coffee to favorites",
        }),
        screen.getByRole("button", {
          name: "Directions to Blue Bottle Coffee",
        }),
        screen.getByRole("button", { name: "Rate Blue Bottle Coffee" }),
        screen.getByRole("button", {
          name: "Add Blue Bottle Coffee to a collection",
        }),
        screen.getByRole("button", { name: "Share Blue Bottle Coffee" }),
        screen.getByRole("link", { name: /visit the website of/i }),
        screen.getByRole("link", { name: /^Reserve/ }),
      ];
      for (const control of controls) {
        for (const ring of RING_CLASSES) {
          expect(control).toHaveClass(ring);
        }
      }
    });

    it("hides decorative icons inside labelled controls from screen readers", async () => {
      await renderMainCard();
      for (const name of [
        "Directions to Blue Bottle Coffee",
        "Rate Blue Bottle Coffee",
        "Add Blue Bottle Coffee to a collection",
      ]) {
        const icon = screen.getByRole("button", { name }).querySelector("svg");
        expect(icon).toHaveAttribute("aria-hidden", "true");
      }
    });

    it("uses native, focusable controls so Enter and Space work", async () => {
      await renderMainCard();
      const controls = [
        screen.getByRole("button", {
          name: "Directions to Blue Bottle Coffee",
        }),
        screen.getByRole("button", { name: "Rate Blue Bottle Coffee" }),
        screen.getByRole("button", {
          name: "Add Blue Bottle Coffee to favorites",
        }),
        screen.getByRole("link", { name: /visit the website of/i }),
      ];
      for (const control of controls) {
        // Native <button> and <a href> are activated by Enter / Space
        // (button) and Enter (link) by the browser, with no key handlers.
        expect(["BUTTON", "A"]).toContain(control.tagName);
        expect(control).not.toHaveAttribute("tabindex", "-1");
        act(() => control.focus());
        expect(control).toHaveFocus();
      }
    });

    it("still runs the handlers when the controls are activated", async () => {
      const { onGetDirections, onRate } = await renderMainCard();
      screen
        .getByRole("button", { name: "Directions to Blue Bottle Coffee" })
        .click();
      screen.getByRole("button", { name: "Rate Blue Bottle Coffee" }).click();
      expect(onGetDirections).toHaveBeenCalledWith(venue);
      expect(onRate).toHaveBeenCalledWith(venue);
    });

    it("names every audio guide trigger after the venue", async () => {
      await renderMainCard();
      // The card renders the trigger in more than one layout; all must be named.
      const triggers = await screen.findAllByRole("button", {
        name: "Preset focus soundscapes player for Blue Bottle Coffee",
      });
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) {
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      }
    });
  });

  describe("compact card", () => {
    const compact = {
      id: "c-1",
      name: "Blue Bottle Coffee",
      description: "Pour-overs.",
    };

    it("has no axe violations", async () => {
      const { container } = render(
        <CompactVenueCard venue={compact} onBook={jest.fn()} />,
      );
      const results = await runAxe(container);
      expect(results.violations).toEqual([]);
    });

    it("names bookmark, favorite, share and booking after the venue", () => {
      render(<CompactVenueCard venue={compact} onBook={jest.fn()} />);
      for (const name of [
        "Bookmark Blue Bottle Coffee",
        "Favorite Blue Bottle Coffee",
        "Share Blue Bottle Coffee",
        "Instant booking for Blue Bottle Coffee",
      ]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
    });

    it("uses the blue focus ring with an offset on every action", () => {
      render(<CompactVenueCard venue={compact} onBook={jest.fn()} />);
      for (const button of screen.getAllByRole("button")) {
        for (const ring of RING_CLASSES) {
          expect(button).toHaveClass(ring);
        }
      }
    });

    it("keeps a logical Tab order: bookmark, favorite, share, then booking", () => {
      render(<CompactVenueCard venue={compact} onBook={jest.fn()} />);
      const order = screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
      expect(order).toEqual([
        "Bookmark Blue Bottle Coffee",
        "Favorite Blue Bottle Coffee",
        "Share Blue Bottle Coffee",
        "Instant booking for Blue Bottle Coffee",
      ]);
    });
  });

  describe("shared controls", () => {
    it("names the audio guide trigger after the venue and tracks its state", () => {
      render(
        <AmbientSoundPlayer
          noiseLevel="quiet"
          venueName="Blue Bottle Coffee"
        />,
      );
      const trigger = screen.getByTestId("ambient-sound-trigger");
      expect(trigger).toHaveAccessibleName(
        "Preset focus soundscapes player for Blue Bottle Coffee",
      );
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      for (const ring of RING_CLASSES) {
        expect(trigger).toHaveClass(ring);
      }
      act(() => trigger.click());
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("keeps the previous audio trigger name when no venue name is given", () => {
      render(<AmbientSoundPlayer noiseLevel="quiet" />);
      expect(screen.getByTestId("ambient-sound-trigger")).toHaveAccessibleName(
        "Preset focus soundscapes player",
      );
    });

    it("gives the share button the same focus-visible ring", () => {
      render(<VenueShareButton venueId="v-1" venueName="Blue Bottle Coffee" />);
      const button = screen.getByRole("button", {
        name: "Share Blue Bottle Coffee",
      });
      for (const ring of RING_CLASSES) {
        expect(button).toHaveClass(ring);
      }
      expect(button.className).not.toContain("focus:ring-violet");
    });
  });
});
