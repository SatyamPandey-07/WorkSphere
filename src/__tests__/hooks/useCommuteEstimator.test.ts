import { renderHook, act } from "@testing-library/react";
import { useCommuteEstimator } from "@/hooks/useCommuteEstimator";

describe("useCommuteEstimator Hook (#6796)", () => {
  const defaultProps = {
    venueLatitude: 37.7749,
    venueLongitude: -122.4194,
    venueName: "San Francisco Focus Hub",
  };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("initializes with transit mode and computes estimates", () => {
    const { result } = renderHook(() => useCommuteEstimator(defaultProps));

    expect(result.current.activeMode).toBe("transit");
    expect(result.current.activeEstimate).toBeDefined();
    expect(result.current.activeEstimate?.mode).toBe("transit");
    expect(result.current.allEstimates).toBeDefined();
    expect(result.current.allEstimates?.walking).toBeDefined();
  });

  it("returns null estimates if venue coordinates are not finite", () => {
    const { result } = renderHook(() =>
      useCommuteEstimator({
        venueLatitude: NaN,
        venueLongitude: -122.4194,
      }),
    );

    expect(result.current.allEstimates).toBeNull();
    expect(result.current.activeEstimate).toBeNull();
  });

  it("updates active mode and stores preference in localStorage", () => {
    const { result } = renderHook(() => useCommuteEstimator(defaultProps));

    act(() => {
      result.current.setActiveMode("cycling");
    });

    expect(result.current.activeMode).toBe("cycling");
    expect(result.current.activeEstimate?.mode).toBe("cycling");
    expect(localStorage.getItem("worksphere:preferred_commute_mode")).toBe("cycling");
  });

  it("toggles weekly projection and adjusts work days", () => {
    const { result } = renderHook(() => useCommuteEstimator(defaultProps));

    expect(result.current.showWeeklyProjection).toBe(false);

    act(() => {
      result.current.setShowWeeklyProjection(true);
      result.current.setWorkDaysPerWeek(4);
    });

    expect(result.current.showWeeklyProjection).toBe(true);
    expect(result.current.workDaysPerWeek).toBe(4);
  });
});
