import { renderHook, act } from "@testing-library/react";
import { usePreferenceReranking } from "@/hooks/usePreferenceReranking";
import { Venue } from "@/components/chat/ChatMessages";

describe("usePreferenceReranking", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const v1 = {
    id: "1",
    name: "v1",
    lat: 0,
    lng: 0,
    category: "cafe",
    wifi: true,
    noiseLevel: "quiet",
    hasOutlets: true,
  } as Venue;
  const v2 = {
    id: "2",
    name: "v2",
    lat: 0,
    lng: 0,
    category: "park",
    wifi: false,
    noiseLevel: "quiet",
    hasOutlets: false,
  } as Venue;

  it("returns original order when disabled", () => {
    const { result } = renderHook(() => usePreferenceReranking([v2, v1]));

    expect(result.current.personalizationEnabled).toBe(false);
    expect(result.current.rerankedResults[0].id).toBe("2");
    expect(result.current.rerankedResults[1].id).toBe("1");
    expect(result.current.rerankedResults[0].isRecommended).toBe(false);
  });

  it("reranks when enabled", () => {
    const { result } = renderHook(() => usePreferenceReranking([v2, v1]));

    act(() => {
      result.current.togglePersonalization(true);
    });

    expect(result.current.personalizationEnabled).toBe(true);
    // Since mock history prefers wifi, quiet, outlets, v1 should score higher than v2
    expect(result.current.rerankedResults[0].id).toBe("1");
    expect(result.current.rerankedResults[1].id).toBe("2");
  });

  it("loads preference from localStorage", () => {
    localStorage.setItem("ai_personalization_enabled", "true");
    const { result } = renderHook(() => usePreferenceReranking([v2, v1]));

    expect(result.current.personalizationEnabled).toBe(true);
  });
});
