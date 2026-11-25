import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteProfileCard } from '@/components/maps/RouteProfileCard';
import { RouteProfileEvaluation } from '@/lib/routing/elevation';

describe('RouteProfileCard Component (#9757)', () => {
  const mockAccessibleEvaluation: RouteProfileEvaluation = {
    hasElevationData: true,
    totalDistanceMeters: 350,
    totalAscentMeters: 12,
    totalDescentMeters: 4,
    minElevationMeters: 20,
    maxElevationMeters: 32,
    profilePoints: [
      {
        index: 0,
        lat: 37.77,
        lng: -122.41,
        distanceFromStartMeters: 0,
        segmentDistanceMeters: 0,
        elevationMeters: 20,
        gradePercent: 0,
        isUphill: false,
        isSteepWarning: false,
        isWheelchairInaccessibleSlope: false,
      },
      {
        index: 1,
        lat: 37.771,
        lng: -122.411,
        distanceFromStartMeters: 175,
        segmentDistanceMeters: 175,
        elevationMeters: 26,
        gradePercent: 3.4,
        isUphill: true,
        isSteepWarning: false,
        isWheelchairInaccessibleSlope: false,
      },
      {
        index: 2,
        lat: 37.772,
        lng: -122.412,
        distanceFromStartMeters: 350,
        segmentDistanceMeters: 175,
        elevationMeters: 32,
        gradePercent: 3.4,
        isUphill: true,
        isSteepWarning: false,
        isWheelchairInaccessibleSlope: false,
      },
    ],
    incline: {
      maxUphillGradePercent: 3.4,
      maxDownhillGradePercent: 0,
      avgUphillGradePercent: 3.4,
      exceedsSteepWarningThreshold: false,
      exceedsWheelchairInclineThreshold: false,
      steepSegmentsDistanceMeters: 0,
      wheelchairInaccessibleDistanceMeters: 0,
      steepSegmentCount: 0,
      wheelchairInaccessibleSegmentCount: 0,
    },
    accessibility: {
      isElevationAvailable: true,
      status: 'accessible',
      summary: 'Accessible route profile: Low incline with step-free access verified.',
      warnings: [],
      stairStatus: 'no_stairs',
      totalAscentMeters: 12,
      totalDescentMeters: 4,
      minElevationMeters: 20,
      maxElevationMeters: 32,
      maxUphillGradePercent: 3.4,
      incline: {
        maxUphillGradePercent: 3.4,
        maxDownhillGradePercent: 0,
        avgUphillGradePercent: 3.4,
        exceedsSteepWarningThreshold: false,
        exceedsWheelchairInclineThreshold: false,
        steepSegmentsDistanceMeters: 0,
        wheelchairInaccessibleDistanceMeters: 0,
        steepSegmentCount: 0,
        wheelchairInaccessibleSegmentCount: 0,
      },
    },
  };

  it('renders elevation metrics (+12m ascent, -4m descent, max incline 3.4%)', () => {
    render(<RouteProfileCard evaluation={mockAccessibleEvaluation} />);

    expect(screen.getByTestId('route-elevation-ascent')).toHaveTextContent('+12m');
    expect(screen.getByTestId('route-elevation-descent')).toHaveTextContent('-4m');
    expect(screen.getByTestId('route-max-incline')).toHaveTextContent('3.4%');
  });

  it('renders wheelchair-accessible badge when step-free and slope is low', () => {
    render(<RouteProfileCard evaluation={mockAccessibleEvaluation} />);

    expect(screen.getByTestId('accessibility-badge-accessible')).toBeInTheDocument();
    expect(screen.getByText('Wheelchair Accessible Slope')).toBeInTheDocument();
    expect(screen.getByTestId('notice-step-free-verified')).toBeInTheDocument();
  });

  it('renders warning badge when slope exceeds 8%', () => {
    const warningEvaluation: RouteProfileEvaluation = {
      ...mockAccessibleEvaluation,
      incline: {
        ...mockAccessibleEvaluation.incline,
        maxUphillGradePercent: 8.2,
        exceedsSteepWarningThreshold: true,
      },
      accessibility: {
        ...mockAccessibleEvaluation.accessibility,
        status: 'warning',
        summary: 'Caution: Steep pedestrian incline (8.2% grade).',
      },
    };

    render(<RouteProfileCard evaluation={warningEvaluation} />);

    expect(screen.getByTestId('accessibility-badge-warning')).toBeInTheDocument();
    expect(screen.getByText('Steep Incline Warning (>8%)')).toBeInTheDocument();
    expect(screen.getByTestId('warning-steep-slope')).toBeInTheDocument();
  });

  it('renders wheelchair limit exceeded alert when slope exceeds 8.33%', () => {
    const steepEvaluation: RouteProfileEvaluation = {
      ...mockAccessibleEvaluation,
      incline: {
        ...mockAccessibleEvaluation.incline,
        maxUphillGradePercent: 9.1,
        exceedsSteepWarningThreshold: true,
        exceedsWheelchairInclineThreshold: true,
        wheelchairInaccessibleDistanceMeters: 80,
      },
      accessibility: {
        ...mockAccessibleEvaluation.accessibility,
        status: 'inaccessible',
        summary: 'Route is not wheelchair-accessible due to steep incline.',
      },
    };

    render(<RouteProfileCard evaluation={steepEvaluation} />);

    expect(screen.getByTestId('accessibility-badge-inaccessible')).toBeInTheDocument();
    expect(screen.getByTestId('warning-wheelchair-incline')).toBeInTheDocument();
  });

  it('renders unknown badge and stairs notice when stair status is unknown', () => {
    const unknownStairsEvaluation: RouteProfileEvaluation = {
      ...mockAccessibleEvaluation,
      accessibility: {
        ...mockAccessibleEvaluation.accessibility,
        status: 'unknown',
        stairStatus: 'unknown',
      },
    };

    render(<RouteProfileCard evaluation={unknownStairsEvaluation} />);

    expect(screen.getByTestId('accessibility-badge-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('notice-stairs-unknown')).toBeInTheDocument();
  });

  it('renders missing elevation notice when elevation data is unavailable', () => {
    const missingElevationEval: RouteProfileEvaluation = {
      ...mockAccessibleEvaluation,
      hasElevationData: false,
      totalAscentMeters: 0,
      totalDescentMeters: 0,
      minElevationMeters: null,
      maxElevationMeters: null,
      profilePoints: [],
      accessibility: {
        ...mockAccessibleEvaluation.accessibility,
        isElevationAvailable: false,
        status: 'unknown',
      },
    };

    render(<RouteProfileCard evaluation={missingElevationEval} />);

    expect(screen.getByTestId('route-elevation-ascent')).toHaveTextContent('--');
    expect(screen.getByTestId('route-elevation-missing-notice')).toBeInTheDocument();
  });

  it('toggles collapsible profile section', () => {
    render(<RouteProfileCard evaluation={mockAccessibleEvaluation} defaultExpanded={true} />);

    expect(screen.getByTestId('route-elevation-chart-container')).toBeInTheDocument();

    const collapseButton = screen.getByRole('button', { name: /collapse route profile/i });
    fireEvent.click(collapseButton);

    expect(screen.queryByTestId('route-elevation-chart-container')).not.toBeInTheDocument();
  });
});
