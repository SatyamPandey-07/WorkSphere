import React from "react";
import { render, act, fireEvent } from "@testing-library/react";
import { useHoverPredictor } from "../../hooks/useHoverPredictor";

function TestComponent({ onPredict }: { onPredict: () => void }) {
  const ref = useHoverPredictor({
    onPredict,
    hoverTimeThreshold: 100,
  });

  return <div data-testid="target" ref={ref} />;
}

describe("useHoverPredictor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not predict on the initial mouse movement event", () => {
    const onPredict = jest.fn();

    const { getByTestId } = render(<TestComponent onPredict={onPredict} />);

    const target = getByTestId("target");

    act(() => {
      fireEvent.mouseEnter(target);
    });

    act(() => {
      fireEvent.mouseMove(target, {
        clientX: 100,
        clientY: 100,
      });
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onPredict).not.toHaveBeenCalled();
  });
});
