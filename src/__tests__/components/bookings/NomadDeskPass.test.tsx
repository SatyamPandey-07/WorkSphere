import React from "react";
import { act, render, screen } from "@testing-library/react";
import {
  buildDeskPassPngFilename,
  NomadDeskPass,
  resolveVenueLocationSubtitle,
  sanitizeFilenameSegment,
  type NomadDeskBooking,
} from '@/components/bookings/NomadDeskPass';

describe('NomadDeskPass Location Subtitle and Neighborhood Fallback', () => {
  const baseBooking: NomadDeskBooking = {
    id: 'test-booking-1',
    confirmationId: 'CONF-10628',
    date: '2026-11-26',
    time: '10:00 AM',
    seatNumber: '04',
    venue: {
      name: 'Central Nomad Hub',
      address: '123 Market Street, Suite 400',
      city: 'San Francisco',
      neighborhood: 'Financial District',
      tags: ['Coworking', 'Hi-Speed WiFi'],
    },
  };

  it('displays the existing address when venue.address is available', () => {
    render(<NomadDeskPass booking={baseBooking} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).toHaveTextContent('123 Market Street, Suite 400');
  });

  it('displays city or neighborhood fallback when address is missing or empty', () => {
    const bookingWithNeighborhood: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Bandra Workspace',
        address: '',
        neighborhood: 'Bandra West',
        city: 'Mumbai',
      },
    };

    render(<NomadDeskPass booking={bookingWithNeighborhood} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).toHaveTextContent('Bandra West, Mumbai');
  });

  it('displays single neighborhood or city tag fallback appropriately', () => {
    const bookingOnlyNeighborhood: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'SoHo Collective',
        address: null,
        neighborhood: 'SoHo',
      },
    };

    const { rerender } = render(
      <NomadDeskPass booking={bookingOnlyNeighborhood} isOpen={true} />
    );

    let locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('SoHo');

    const bookingOnlyCity: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Kyoto Station Loft',
        address: undefined,
        city: 'Kyoto',
      },
    };

    rerender(<NomadDeskPass booking={bookingOnlyCity} isOpen={true} />);
    locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('Kyoto');

    const bookingWithTagFallback: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Alpine Work Hub',
        address: '',
        city: '',
        neighborhood: '',
        tags: ['Zermatt Alpine District'],
      },
    };

    rerender(<NomadDeskPass booking={bookingWithTagFallback} isOpen={true} />);
    locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toHaveTextContent('Zermatt Alpine District');
  });

  it('does not render broken or undefined text when both address and location fallbacks are unavailable', () => {
    const bookingNoLocation: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Secret Workspace',
        address: null,
        neighborhood: null,
        city: null,
        tags: null,
      },
    };

    render(<NomadDeskPass booking={bookingNoLocation} isOpen={true} />);

    const locationElem = screen.getByTestId('nomad-desk-pass-location');
    expect(locationElem).toBeInTheDocument();
    expect(locationElem).not.toHaveTextContent('undefined');
    expect(locationElem).not.toHaveTextContent('null');
    expect(locationElem).toHaveTextContent('');
  });

  it('maintains a stable subtitle container to prevent layout shift between address and fallback', () => {
    const { container, rerender } = render(
      <NomadDeskPass booking={baseBooking} isOpen={true} />
    );

    const locationWithAddress = screen.getByTestId('nomad-desk-pass-location');
    expect(locationWithAddress).toHaveClass('min-h-[1.5rem]');
    expect(locationWithAddress).toHaveClass('text-sm');

    const bookingFallback: NomadDeskBooking = {
      ...baseBooking,
      venue: {
        name: 'Central Nomad Hub',
        address: '',
        neighborhood: 'Financial District',
      },
    };

    rerender(<NomadDeskPass booking={bookingFallback} isOpen={true} />);
    const locationWithFallback = screen.getByTestId('nomad-desk-pass-location');
    expect(locationWithFallback).toHaveClass('min-h-[1.5rem]');
    expect(locationWithFallback).toHaveClass('text-sm');
  });
});

describe('NomadDeskPass PNG filename sanitization and export', () => {
  it('strips or replaces invalid path characters across Windows/macOS and handles Unicode/empty inputs', () => {
    expect(sanitizeFilenameSegment('Bandra / West \\ Hub: A*B?C')).toBe(
      'Bandra-West-Hub-A-B-C'
    );
    expect(sanitizeFilenameSegment('Café Powai — Studio')).toBe(
      'Cafe-Powai-Studio'
    );
    expect(sanitizeFilenameSegment('   ', 'fallback-venue')).toBe(
      'fallback-venue'
    );
    expect(sanitizeFilenameSegment('', 'fallback-id')).toBe('fallback-id');

    expect(
      buildDeskPassPngFilename('Bandra/West: Studio *1?', 'CONF\\2026:01/02')
    ).toBe('nomad-desk-pass-Bandra-West-Studio-1-CONF-2026-01-02.png');
  });

const renderPass = async (address?: string | null) => {
  await act(async () => {
    render(
      <NomadDeskPass
        booking={createBooking(address)}
        isOpen
        onClose={jest.fn()}
      />,
    );
  });
};

describe("NomadDeskPass address rendering", () => {
  it.each([null, undefined, "", "   "])(
    "omits the address row when the address is %p",
    async (address) => {
      await renderPass(address);

      expect(
        screen.queryByTestId("nomad-desk-pass-address"),
      ).not.toBeInTheDocument();
    },
  );

  it("renders a valid venue address", async () => {
    await renderPass("Jaipur, Rajasthan");

    expect(screen.getByTestId("nomad-desk-pass-address")).toHaveTextContent(
      "Jaipur, Rajasthan",
    );
  });
});

describe("NomadDeskPass PNG filename sanitization", () => {
  it("sanitizes invalid path characters and handles Unicode and empty inputs", () => {
    expect(sanitizeFilenameSegment("Bandra / West \\ Hub: A*B?C")).toBe(
      "Bandra-West-Hub-A-B-C",
    );
    expect(sanitizeFilenameSegment("Café Powai — Studio")).toBe(
      "Cafe-Powai-Studio",
    );
    expect(sanitizeFilenameSegment("   ", "fallback-venue")).toBe(
      "fallback-venue",
    );
    expect(sanitizeFilenameSegment("", "fallback-id")).toBe("fallback-id");

    expect(
      buildDeskPassPngFilename("Bandra/West: Studio *1?", "CONF\\2026:01/02"),
    ).toBe("nomad-desk-pass-Bandra-West-Studio-1-CONF-2026-01-02.png");
  });
});
