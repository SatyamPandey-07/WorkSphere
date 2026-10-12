import { render, screen } from "@testing-library/react";
import { WebSocketLatencyBadge } from "@/components/WebSocketLatencyBadge";

describe("WebSocketLatencyBadge", () => {
  it("renders latency in ms when latencyMs is provided", () => {
    render(<WebSocketLatencyBadge latencyMs={45} tier="good" />);
    expect(screen.getByText(/45 ms/)).toBeInTheDocument();
  });

  it("shows tier label when latencyMs is null", () => {
    render(<WebSocketLatencyBadge latencyMs={null} tier="unknown" />);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("has aria-label describing connection quality for 'good' tier", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={30} tier="good" />,
    );
    const div = container.querySelector("[aria-label]");
    expect(div!.getAttribute("aria-label")).toMatch(/good/i);
  });

  it("has aria-label describing connection quality for 'poor' tier", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={200} tier="poor" />,
    );
    const div = container.querySelector("[aria-label]");
    expect(div!.getAttribute("aria-label")).toMatch(/poor/i);
  });

  it("applies green text class for 'good' tier", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={40} tier="good" />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toMatch(/green/);
  });

  it("applies yellow text class for 'fair' tier", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={100} tier="fair" />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toMatch(/yellow/);
  });

  it("applies red text class for 'poor' tier", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={300} tier="poor" />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toMatch(/red/);
  });

  it("renders Wifi icon", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={50} tier="good" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <WebSocketLatencyBadge
        latencyMs={50}
        tier="good"
        className="custom-class"
      />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "custom-class",
    );
  });

  it("clamps negative latency to 0 ms during client clock skew", () => {
    render(<WebSocketLatencyBadge latencyMs={-6} tier="good" />);
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    expect(screen.queryByText("-6 ms")).not.toBeInTheDocument();
  });

  it("clamps large negative latency values to 0 ms in title and aria-label", () => {
    const { container } = render(
      <WebSocketLatencyBadge latencyMs={-120} tier="good" />,
    );
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    const div = container.querySelector("[aria-label]");
    expect(div!.getAttribute("aria-label")).toBe(
      "Connection quality: Good (0 ms)",
    );
    expect(div!.getAttribute("title")).toBe("WebSocket latency: 0 ms");
  });
});
