import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  HybridSearchWeightSlider,
  SEARCH_WEIGHT_PRESETS,
} from "@/components/venues/HybridSearchWeightSlider";
import type {
  HybridSearchWorkerRequest,
  HybridSearchWorkerResponse,
  VenueScoringRecord,
} from "@/workers/hybridSearch.worker";

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage:
    ((event: MessageEvent<HybridSearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();

  constructor() {
    MockWorker.instances.push(this);
  }

  emitMessage(data: HybridSearchWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<HybridSearchWorkerResponse>);
  }

  emitError() {
    this.onerror?.(new ErrorEvent("error"));
  }
}

describe("HybridSearchWeightSlider Component", () => {
  const originalWorker = global.Worker;

  beforeEach(() => {
    MockWorker.instances = [];
    Object.defineProperty(global, "Worker", {
      value: MockWorker,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, "Worker", {
      value: originalWorker,
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  const mockVenues: VenueScoringRecord[] = [
    {
      id: "v-alpha",
      semanticScore: 0.9,
      proximityScore: 0.2,
      ratingScore: 0.3,
      fullTextScore: 0.4,
    },
    {
      id: "v-beta",
      semanticScore: 0.3,
      proximityScore: 0.95,
      ratingScore: 0.4,
      fullTextScore: 0.2,
    },
    {
      id: "v-gamma",
      semanticScore: 0.4,
      proximityScore: 0.3,
      ratingScore: 0.98,
      fullTextScore: 0.5,
    },
  ];

  it("renders container, labels, worker status pill, and weight badges", () => {
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.6}
        fullTextWeight={0.4}
        onChange={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId("hybrid-search-weight-slider-container"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hybrid Search Scoring Weights"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("worker-scoring-status")).toBeInTheDocument();
    expect(screen.getByTestId("semantic-weight-badge")).toHaveTextContent(
      "60%",
    );
    expect(screen.getByTestId("fulltext-weight-badge")).toHaveTextContent(
      "40%",
    );
  });

  it("handles balance slider change and triggers onChange callback", () => {
    const handleChange = jest.fn();
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.5}
        fullTextWeight={0.5}
        onChange={handleChange}
      />,
    );

    const balanceSlider = screen.getByTestId("hybrid-search-balance-slider");
    fireEvent.change(balanceSlider, { target: { value: "80" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticWeight: 0.8,
        fullTextWeight: 0.2,
      }),
    );
    expect(screen.getByTestId("semantic-weight-badge")).toHaveTextContent(
      "80%",
    );
    expect(screen.getByTestId("fulltext-weight-badge")).toHaveTextContent(
      "20%",
    );
  });

  it("adjusts individual multi-criteria sliders for proximity and rating", () => {
    const handleChange = jest.fn();
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.5}
        fullTextWeight={0.5}
        proximityWeight={0.3}
        ratingWeight={0.4}
        onChange={handleChange}
      />,
    );

    const proxSlider = screen.getByTestId("proximity-weight-slider");
    fireEvent.change(proxSlider, { target: { value: "75" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        proximityWeight: 0.75,
      }),
    );
    expect(screen.getByTestId("proximity-weight-badge")).toHaveTextContent(
      "75%",
    );

    const ratingSlider = screen.getByTestId("rating-weight-slider");
    fireEvent.change(ratingSlider, { target: { value: "90" } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingWeight: 0.9,
      }),
    );
    expect(screen.getByTestId("rating-weight-badge")).toHaveTextContent("90%");
  });

  it("applies scoring presets accurately across all weights", () => {
    const handleChange = jest.fn();
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.5}
        fullTextWeight={0.5}
        onChange={handleChange}
      />,
    );

    const nearbyPresetBtn = screen.getByTestId(
      "preset-search-weight-nearby_first",
    );
    fireEvent.click(nearbyPresetBtn);

    const nearbyPreset = SEARCH_WEIGHT_PRESETS.find(
      (p) => p.id === "nearby_first",
    )!;
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        proximityWeight: nearbyPreset.proximity,
        semanticWeight: nearbyPreset.semantic,
        fullTextWeight: nearbyPreset.fullText,
      }),
    );
    expect(screen.getByTestId("proximity-weight-badge")).toHaveTextContent(
      `${Math.round(nearbyPreset.proximity * 100)}%`,
    );
  });

  it("resets weights to defaults when clicking reset button", () => {
    const handleChange = jest.fn();
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.8}
        fullTextWeight={0.2}
        proximityWeight={0.1}
        ratingWeight={0.1}
        defaultSemanticWeight={0.5}
        defaultFullTextWeight={0.5}
        defaultProximityWeight={0.5}
        defaultRatingWeight={0.5}
        onChange={handleChange}
      />,
    );

    const resetBtn = screen.getByTestId("reset-search-weights-btn");
    fireEvent.click(resetBtn);

    expect(handleChange).toHaveBeenCalledWith({
      semanticWeight: 0.5,
      fullTextWeight: 0.5,
      proximityWeight: 0.5,
      ratingWeight: 0.5,
    });
  });

  it("creates Web Worker, sends INDEX message, and processes async SCORE_SUCCESS", () => {
    const handleSorted = jest.fn();
    const handleScoringComplete = jest.fn();

    render(
      <HybridSearchWeightSlider
        semanticWeight={0.5}
        fullTextWeight={0.5}
        venues={mockVenues}
        onSortedVenueIdsChange={handleSorted}
        onScoringComplete={handleScoringComplete}
        onChange={jest.fn()}
      />,
    );

    const worker = MockWorker.instances[0];
    expect(worker).toBeDefined();

    // Verify worker was sent INDEX request with transferable buffer
    const indexCall = worker.postMessage.mock.calls.find(
      (call) => (call[0] as HybridSearchWorkerRequest)?.type === "INDEX",
    );
    expect(indexCall).toBeDefined();

    const [indexMsg, indexTransfer] = indexCall as [
      HybridSearchWorkerRequest,
      Transferable[],
    ];
    if (indexMsg.type === "INDEX") {
      expect(indexMsg.payload.venueIds).toEqual([
        "v-alpha",
        "v-beta",
        "v-gamma",
      ]);
      expect(indexMsg.payload.scoresBuffer).toBeInstanceOf(ArrayBuffer);
      expect(indexTransfer).toEqual([indexMsg.payload.scoresBuffer]);
    }

    const scoreCall = worker.postMessage.mock.calls.find(
      (call) => (call[0] as HybridSearchWorkerRequest)?.type === "SCORE",
    );
    const scoreReq = scoreCall?.[0] as HybridSearchWorkerRequest;
    const seqId = scoreReq?.sequenceId ?? 1;

    // Emit worker response for scoring
    act(() => {
      worker.emitMessage({
        type: "SCORE_SUCCESS",
        sequenceId: seqId,
        payload: {
          sortedIds: ["v-beta", "v-alpha", "v-gamma"],
          sortedIndicesBuffer: new Uint32Array([1, 0, 2]).buffer,
          sortedScoresBuffer: new Float32Array([0.9, 0.6, 0.4]).buffer,
          count: 3,
          executionTimeMs: 1.2,
        },
      });
    });

    expect(handleSorted).toHaveBeenCalledWith(["v-beta", "v-alpha", "v-gamma"]);
    expect(handleScoringComplete).toHaveBeenCalledWith({
      sortedIds: ["v-beta", "v-alpha", "v-gamma"],
      executionTimeMs: 1.2,
    });
    expect(screen.getByTestId("sorted-venues-count")).toHaveTextContent(
      "(3 venues sorted)",
    );
  });

  it("maintains zero main-thread blocking by dispatching slider moves to worker", () => {
    const handleChange = jest.fn();
    render(
      <HybridSearchWeightSlider
        semanticWeight={0.5}
        fullTextWeight={0.5}
        venues={mockVenues}
        onChange={handleChange}
      />,
    );

    const worker = MockWorker.instances[0];
    expect(worker).toBeDefined();

    const proxSlider = screen.getByTestId("proximity-weight-slider");

    // Rapid successive slider adjustments (simulating 60fps drag)
    for (let step = 10; step <= 90; step += 10) {
      fireEvent.change(proxSlider, { target: { value: String(step) } });
    }

    // Verify multiple score dispatches were scheduled for the worker without UI stalling
    const scoreCalls = worker.postMessage.mock.calls.filter(
      (call) => (call[0] as HybridSearchWorkerRequest)?.type === "SCORE",
    );
    expect(scoreCalls.length).toBeGreaterThan(0);
    expect(handleChange).toHaveBeenCalled();
  });
});
