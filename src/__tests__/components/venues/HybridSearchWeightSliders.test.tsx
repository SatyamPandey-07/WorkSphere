import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  HybridSearchWeightSliders,
  HYBRID_WEIGHT_PRESETS,
} from "@/components/venues/HybridSearchWeightSliders";

describe("HybridSearchWeightSliders", () => {
  const onSemanticWeightChange = jest.fn();
  const onFullTextWeightChange = jest.fn();
  const onWeightsChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default 50%/50% weights and hides reset button", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
      />
    );

    expect(screen.getByTestId("hybrid-search-weight-sliders")).toBeInTheDocument();
    expect(screen.getByTestId("semantic-weight-readout")).toHaveTextContent("50%");
    expect(screen.getByTestId("fulltext-weight-readout")).toHaveTextContent("50%");
    expect(screen.getByTestId("semantic-weight-slider")).toHaveValue("50");
    expect(screen.getByTestId("fulltext-weight-slider")).toHaveValue("50");

    // Reset button is hidden when values match default
    expect(screen.queryByTestId("reset-hybrid-weights-btn")).not.toBeInTheDocument();
  });

  it("displays reset button when weights deviate from default and resets on click", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={80}
        fullTextWeight={20}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        onWeightsChange={onWeightsChange}
      />
    );

    const resetBtn = screen.getByTestId("reset-hybrid-weights-btn");
    expect(resetBtn).toBeInTheDocument();

    fireEvent.click(resetBtn);

    expect(onSemanticWeightChange).toHaveBeenCalledWith(50);
    expect(onFullTextWeightChange).toHaveBeenCalledWith(50);
    expect(onWeightsChange).toHaveBeenCalledWith(50, 50);
  });

  it("normalizes 0..1 decimal inputs correctly to percentages", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={0.75}
        fullTextWeight={0.25}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
      />
    );

    expect(screen.getByTestId("semantic-weight-readout")).toHaveTextContent("75%");
    expect(screen.getByTestId("fulltext-weight-readout")).toHaveTextContent("25%");
  });

  it("handles NaN, null, and out-of-range inputs safely", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={NaN as unknown as number}
        fullTextWeight={150}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        defaultSemanticWeight={50}
      />
    );

    // NaN should fall back to default (50%)
    expect(screen.getByTestId("semantic-weight-readout")).toHaveTextContent("50%");
    // >100 should clamp to 100%
    expect(screen.getByTestId("fulltext-weight-readout")).toHaveTextContent("100%");
  });

  it("triggers onSemanticWeightChange and onWeightsChange on slider change", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        onWeightsChange={onWeightsChange}
      />
    );

    const slider = screen.getByTestId("semantic-weight-slider");
    fireEvent.change(slider, { target: { value: "70" } });

    expect(onSemanticWeightChange).toHaveBeenCalledWith(70);
    expect(onWeightsChange).toHaveBeenCalledWith(70, 50);
  });

  it("triggers onFullTextWeightChange and onWeightsChange on slider change", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        onWeightsChange={onWeightsChange}
      />
    );

    const slider = screen.getByTestId("fulltext-weight-slider");
    fireEvent.change(slider, { target: { value: "30" } });

    expect(onFullTextWeightChange).toHaveBeenCalledWith(30);
    expect(onWeightsChange).toHaveBeenCalledWith(50, 30);
  });

  it("applies preset weights when quick ratio preset button is clicked", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        onWeightsChange={onWeightsChange}
      />
    );

    const vectorOnlyPreset = HYBRID_WEIGHT_PRESETS.find((p) => p.id === "semantic-only")!;
    const presetBtn = screen.getByTestId(`preset-weight-${vectorOnlyPreset.id}`);
    fireEvent.click(presetBtn);

    expect(onSemanticWeightChange).toHaveBeenCalledWith(100);
    expect(onFullTextWeightChange).toHaveBeenCalledWith(0);
    expect(onWeightsChange).toHaveBeenCalledWith(100, 0);
  });

  it("hides presets when showPresets is false", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        showPresets={false}
      />
    );

    expect(screen.queryByText("Quick Ratios:")).not.toBeInTheDocument();
  });

  it("hides help text footer when showHelpText is false", () => {
    render(
      <HybridSearchWeightSliders
        semanticWeight={50}
        fullTextWeight={50}
        onSemanticWeightChange={onSemanticWeightChange}
        onFullTextWeightChange={onFullTextWeightChange}
        showHelpText={false}
      />
    );

    expect(screen.queryByText(/Reciprocal Rank Fusion/i)).not.toBeInTheDocument();
  });
});
