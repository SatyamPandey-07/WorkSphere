import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AgentDependencyGraph,
  calculateBezierCurve,
  STATUS_THEMES,
  type AgentTaskNode,
  type AgentWorkflowEdge,
} from "@/components/admin/AgentDependencyGraph";

describe("AgentDependencyGraph (Interactive SVG Task DAG)", () => {
  describe("calculateBezierCurve", () => {
    it("generates correct cubic Bezier SVG path data", () => {
      const path = calculateBezierCurve(100, 150, 300, 250);
      expect(path).toBe("M 100 150 C 200 150, 200 250, 300 250");
    });
  });

  describe("Status Color Coding", () => {
    it("maps executing and succeeded to emerald, pending to amber, and failed to crimson", () => {
      expect(STATUS_THEMES.executing.strokeColor).toBe("#10b981");
      expect(STATUS_THEMES.succeeded.strokeColor).toBe("#10b981");
      expect(STATUS_THEMES.pending.strokeColor).toBe("#f59e0b");
      expect(STATUS_THEMES.failed.strokeColor).toBe("#ef4444");
    });
  });

  describe("Component Rendering & Interactions", () => {
    const customNodes: AgentTaskNode[] = [
      {
        id: "ingestion",
        label: "Telemetry Ingestion",
        agentName: "SensorStreamAgent",
        status: "succeeded",
        durationMs: 45,
        x: 50,
        y: 100,
      },
      {
        id: "forecasting",
        label: "Noise Forecasting",
        agentName: "AcousticPredictor",
        status: "executing",
        durationMs: 120,
        x: 280,
        y: 100,
      },
      {
        id: "pricing",
        label: "Dynamic Pricing",
        agentName: "YieldOptimizer",
        status: "pending",
        durationMs: 0,
        x: 510,
        y: 100,
      },
      {
        id: "dispatch",
        label: "Push Notification",
        agentName: "NomadDispatcher",
        status: "failed",
        durationMs: 12,
        x: 740,
        y: 100,
      },
    ];

    const customEdges: AgentWorkflowEdge[] = [
      { from: "ingestion", to: "forecasting" },
      { from: "forecasting", to: "pricing" },
      { from: "pricing", to: "dispatch" },
    ];

    it("renders SVG DAG with all nodes and Bezier curve edges", () => {
      render(
        <AgentDependencyGraph nodes={customNodes} edges={customEdges} />,
      );

      expect(screen.getByTestId("agent-dag-svg")).toBeInTheDocument();
      expect(screen.getByTestId("dag-edges-group")).toBeInTheDocument();
      expect(screen.getByTestId("dag-nodes-group")).toBeInTheDocument();

      // Check all node labels
      expect(screen.getByText("Telemetry Ingestion")).toBeInTheDocument();
      expect(screen.getByText("Noise Forecasting")).toBeInTheDocument();
      expect(screen.getByText("Dynamic Pricing")).toBeInTheDocument();
      expect(screen.getByText("Push Notification")).toBeInTheDocument();

      // Check edges
      expect(screen.getByTestId("dag-edge-ingestion-forecasting")).toBeInTheDocument();
      expect(screen.getByTestId("dag-edge-forecasting-pricing")).toBeInTheDocument();
      expect(screen.getByTestId("dag-edge-pricing-dispatch")).toBeInTheDocument();
    });

    it("displays execution millisecond badges and status tags", () => {
      render(
        <AgentDependencyGraph nodes={customNodes} edges={customEdges} />,
      );

      expect(screen.getByText("45ms")).toBeInTheDocument();
      expect(screen.getByText("120ms")).toBeInTheDocument();
      expect(screen.getByText("0ms")).toBeInTheDocument();
      expect(screen.getByText("12ms")).toBeInTheDocument();

      expect(screen.getByText("SUCCEEDED")).toBeInTheDocument();
      expect(screen.getByText("EXECUTING")).toBeInTheDocument();
      expect(screen.getByText("PENDING")).toBeInTheDocument();
      expect(screen.getByText("FAILED")).toBeInTheDocument();
    });

    it("triggers onSelectNode callback when clicking a node", () => {
      const onSelect = jest.fn();
      render(
        <AgentDependencyGraph
          nodes={customNodes}
          edges={customEdges}
          onSelectNode={onSelect}
        />,
      );

      const forecastingNode = screen.getByTestId("dag-node-forecasting");
      fireEvent.click(forecastingNode);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(customNodes[1]);
    });
  });
});
