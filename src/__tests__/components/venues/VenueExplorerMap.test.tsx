import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
    VenueExplorerMap,
    MAP_VIEWPORT_DEBOUNCE_MS,
    ExplorerVenueItem,
} from '@/components/venues/VenueExplorerMap';

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn(),
    useSearchParams: jest.fn(),
}));

const mockedUseRouter = useRouter as jest.Mock;
const mockedUsePathname = usePathname as jest.Mock;
const mockedUseSearchParams = useSearchParams as jest.Mock;

describe('VenueExplorerMap (300ms Debounced URL Viewport Sync)', () => {
    const replaceMock = jest.fn();

    const sampleVenues: ExplorerVenueItem[] = [
        {
            id: 'venue-kp-1',
            name: 'Blue Tokai Koregaon Park',
            address: 'Lane 5, Koregaon Park, Pune',
            latitude: 18.5362,
            longitude: 73.894,
            wifiSpeedMbps: 140,
            crowdLevel: 'QUIET',
        },
        {
            id: 'venue-bavdhan-1',
            name: 'Bavdhan Work Hub',
            address: 'Bavdhan, Pune',
            latitude: 18.5158,
            longitude: 73.7798,
            wifiSpeedMbps: 120,
            crowdLevel: 'MODERATE',
        },
    ];

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockedUseRouter.mockReturnValue({ replace: replaceMock });
        mockedUsePathname.mockReturnValue('/explore');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('hydrates Koregaon Park bounds from URL searchParams on mount (browser Back restoration)', () => {
        const params = new URLSearchParams(
            'neLat=18.54500&neLng=73.90500&swLat=18.52800&swLng=73.88200&minWifiMbps=100'
        );
        mockedUseSearchParams.mockReturnValue(params);

        render(<VenueExplorerMap venues={sampleVenues} />);

        const mapEl = screen.getByTestId('venue-explorer-map');
        expect(mapEl).toHaveAttribute('data-ne-lat', '18.545');
        expect(mapEl).toHaveAttribute('data-ne-lng', '73.905');
        expect(mapEl).toHaveAttribute('data-sw-lat', '18.528');
        expect(mapEl).toHaveAttribute('data-sw-lng', '73.882');

        // Only the Koregaon Park venue falls inside the restored URL bounds
        expect(screen.getByText('Blue Tokai Koregaon Park')).toBeInTheDocument();
        expect(screen.queryByText('Bavdhan Work Hub')).not.toBeInTheDocument();
    });

    test('debounces map moveend viewport updates by 300ms and calls router.replace(..., { scroll: false }) preserving active filters', () => {
        const params = new URLSearchParams('minWifiMbps=100&crowdLevel=QUIET');
        mockedUseSearchParams.mockReturnValue(params);

        render(<VenueExplorerMap venues={sampleVenues} />);

        const canvas = screen.getByTestId('map-canvas-surface');

        // Trigger rapid pan/moveend events within < 300ms
        fireEvent.doubleClick(canvas);
        act(() => {
            jest.advanceTimersByTime(150);
        });
        fireEvent.doubleClick(canvas);

        // Must not call router.replace before 300ms settles
        expect(replaceMock).not.toHaveBeenCalled();

        // Advance remaining 300ms debounce window
        act(() => {
            jest.advanceTimersByTime(MAP_VIEWPORT_DEBOUNCE_MS);
        });

        expect(replaceMock).toHaveBeenCalledTimes(1);
        const [calledUrl, calledOptions] = replaceMock.mock.calls[0] as [
            string,
            { scroll: boolean },
        ];

        expect(calledOptions).toEqual({ scroll: false });
        expect(calledUrl).toContain('/explore?');
        expect(calledUrl).toContain('minWifiMbps=100');
        expect(calledUrl).toContain('crowdLevel=QUIET');
        expect(calledUrl).toContain('neLat=18.57500');
        expect(calledUrl).toContain('neLng=73.92500');
        expect(calledUrl).toContain('swLat=18.49500');
        expect(calledUrl).toContain('swLng=73.77500');
    });
});