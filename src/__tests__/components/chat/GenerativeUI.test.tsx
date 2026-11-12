import React from "react";
import { render, screen } from "@testing-library/react";
import {
  MessageRenderer,
  DataChart,
  DataTable,
  ComponentErrorBoundary,
} from "@/components/chat/GenerativeUI";

// Mock recharts for clean, fast component rendering
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
  BarChart: ({
    data,
    children,
  }: {
    data: any[];
    children: React.ReactNode;
  }) => (
    <div data-testid="mock-bar-chart" data-rows={data?.length}>
      {children}
    </div>
  ),
  Bar: ({ dataKey, fill }: { dataKey: string; fill: string }) => (
    <div data-testid={`mock-bar-${dataKey}`} data-fill={fill} />
  ),
  XAxis: ({ dataKey }: { dataKey: string }) => (
    <div data-testid="mock-x-axis" data-key={dataKey} />
  ),
  YAxis: () => <div data-testid="mock-y-axis" />,
  CartesianGrid: () => <div data-testid="mock-grid" />,
  Tooltip: () => <div data-testid="mock-tooltip" />,
}));

// Mock next/dynamic for synchronous rendering without hydration delay
jest.mock("next/dynamic", () => () => {
  const DynamicMock = (props: any) => (
    <div
      data-testid="mock-interactive-map"
      data-lat={props?.center?.lat}
      data-lng={props?.center?.lng}
      data-markers-count={props?.markers?.length || 0}
    >
      Interactive Map Mock
    </div>
  );
  DynamicMock.displayName = "DynamicMock";
  return DynamicMock;
});

describe("GenerativeUI Components & Renderer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("DataChart Component", () => {
    it("renders empty fallback when data is null, undefined, or empty", () => {
      const { rerender } = render(<DataChart data={[]} />);
      expect(screen.getByTestId("data-chart-empty")).toBeInTheDocument();
      expect(screen.getByText("No data available")).toBeInTheDocument();

      rerender(<DataChart data={undefined} />);
      expect(screen.getByTestId("data-chart-empty")).toBeInTheDocument();
    });

    it("renders chart with standard tabular data and columns", () => {
      const data = [
        { month: "Jan", bookings: 120, revenue: 2400 },
        { month: "Feb", bookings: 150, revenue: 3000 },
      ];
      const columns = ["month", "bookings", "revenue"];

      render(<DataChart data={data} columns={columns} />);

      expect(screen.getByTestId("data-chart")).toBeInTheDocument();
      expect(screen.getByText("Data Visualization")).toBeInTheDocument();
      expect(screen.getByTestId("mock-x-axis")).toHaveAttribute(
        "data-key",
        "month",
      );
      expect(screen.getByTestId("mock-bar-bookings")).toBeInTheDocument();
      expect(screen.getByTestId("mock-bar-revenue")).toBeInTheDocument();
    });

    it("renders chart and transforms datasets/labels format into tabular rows", () => {
      const labels = ["Q1", "Q2", "Q3"];
      const datasets = [
        { label: "Signups", data: [50, 80, 120] },
        { label: "Upgrades", data: [10, 25, 40] },
      ];

      render(<DataChart labels={labels} datasets={datasets} />);

      expect(screen.getByTestId("data-chart")).toBeInTheDocument();
      expect(screen.getByTestId("mock-x-axis")).toHaveAttribute(
        "data-key",
        "label",
      );
      expect(screen.getByTestId("mock-bar-Signups")).toBeInTheDocument();
      expect(screen.getByTestId("mock-bar-Upgrades")).toBeInTheDocument();
      expect(screen.getByTestId("mock-bar-chart")).toHaveAttribute(
        "data-rows",
        "3",
      );
    });

    it("derives columns from data keys when columns prop is omitted", () => {
      const data = [
        { venue: "Hub A", checkins: 85 },
        { venue: "Hub B", checkins: 42 },
      ];

      render(<DataChart data={data} />);

      expect(screen.getByTestId("data-chart")).toBeInTheDocument();
      expect(screen.getByTestId("mock-x-axis")).toHaveAttribute(
        "data-key",
        "venue",
      );
      expect(screen.getByTestId("mock-bar-checkins")).toBeInTheDocument();
    });
  });

  describe("DataTable Component", () => {
    it("renders empty fallback when data is null, undefined, or empty", () => {
      const { rerender } = render(<DataTable data={[]} />);
      expect(screen.getByTestId("data-table-empty")).toBeInTheDocument();
      expect(screen.getByText("No data to display")).toBeInTheDocument();

      rerender(<DataTable data={undefined} />);
      expect(screen.getByTestId("data-table-empty")).toBeInTheDocument();
    });

    it("renders data table with provided columns and rows", () => {
      const data = [
        { name: "Coffee Lab", city: "Tokyo", speed: "120 Mbps" },
        { name: "Nomad Loft", city: "Chiang Mai", speed: "95 Mbps" },
      ];
      const columns = ["name", "city", "speed"];

      render(<DataTable data={data} columns={columns} />);

      expect(screen.getByTestId("data-table")).toBeInTheDocument();
      expect(screen.getByText("Coffee Lab")).toBeInTheDocument();
      expect(screen.getByText("Tokyo")).toBeInTheDocument();
      expect(screen.getByText("Nomad Loft")).toBeInTheDocument();
      expect(screen.getByText("Chiang Mai")).toBeInTheDocument();
      expect(screen.getByTestId("data-table-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("data-table-row-1")).toBeInTheDocument();
    });

    it("derives columns automatically from first data row when columns prop is missing", () => {
      const data = [
        { tier: "Pro", price: "$49", active: true },
      ];

      render(<DataTable data={data} />);

      expect(screen.getByTestId("data-table")).toBeInTheDocument();
      expect(screen.getByText("Pro")).toBeInTheDocument();
      expect(screen.getByText("$49")).toBeInTheDocument();
      expect(screen.getByText("true")).toBeInTheDocument();
    });

    it("renders fallback dash for null or undefined cell values", () => {
      const data = [
        { item: "Desk A", price: null, notes: undefined },
      ];

      render(<DataTable data={data} columns={["item", "price", "notes"]} />);

      const cells = screen.getAllByText("—");
      expect(cells.length).toBe(2);
    });
  });

  describe("ComponentErrorBoundary", () => {
    // Suppress console.error during deliberate error throwing test
    const originalConsoleError = console.error;
    beforeEach(() => {
      console.error = jest.fn();
    });
    afterEach(() => {
      console.error = originalConsoleError;
    });

    const ProblematicChild = () => {
      throw new Error("Simulated rendering explosion");
    };

    it("renders children cleanly when no error occurs", () => {
      render(
        <ComponentErrorBoundary componentName="TestWidget">
          <div>Healthy Child Content</div>
        </ComponentErrorBoundary>,
      );
      expect(screen.getByText("Healthy Child Content")).toBeInTheDocument();
    });

    it("catches render errors and renders alert banner with componentName and error message", () => {
      render(
        <ComponentErrorBoundary componentName="FailingWidget">
          <ProblematicChild />
        </ComponentErrorBoundary>,
      );

      expect(screen.getByTestId("component-error-boundary")).toBeInTheDocument();
      expect(
        screen.getByText("Failed to render FailingWidget"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("error-message")).toHaveTextContent(
        "Simulated rendering explosion",
      );
    });
  });

  describe("MessageRenderer Component", () => {
    it("returns null when content is null, undefined, or empty", () => {
      const { container: c1 } = render(<MessageRenderer content={null} />);
      expect(c1).toBeEmptyDOMElement();

      const { container: c2 } = render(<MessageRenderer content={undefined} />);
      expect(c2).toBeEmptyDOMElement();

      const { container: c3 } = render(<MessageRenderer content="" />);
      expect(c3).toBeEmptyDOMElement();
    });

    it("renders standard plain text without ui-component tags", () => {
      render(
        <MessageRenderer content="Here is your requested venue analysis overview." />,
      );
      expect(
        screen.getByText("Here is your requested venue analysis overview."),
      ).toBeInTheDocument();
    });

    it("highlights speaking sentence when speakingSentenceIndex is provided", () => {
      const text = "First sentence. Second sentence! Third sentence?";
      render(
        <MessageRenderer content={text} speakingSentenceIndex={1} />,
      );

      const highlight = screen.getByTestId("text-highlight");
      expect(highlight).toBeInTheDocument();
      expect(highlight).toHaveTextContent("Second sentence!");
    });

    it("parses and renders DataTable component from message content", () => {
      const content = `Here are the top venues:
<ui-component name="DataTable" props='{"columns":["venue","rating"],"data":[{"venue":"Cafe Artisan","rating":4.9},{"venue":"Hub 9","rating":4.7}]}' />
Please let me know if you want more details.`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByText("Here are the top venues:")).toBeInTheDocument();
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
      expect(screen.getByText("Cafe Artisan")).toBeInTheDocument();
      expect(screen.getByText("4.9")).toBeInTheDocument();
      expect(screen.getByText("Hub 9")).toBeInTheDocument();
      expect(
        screen.getByText("Please let me know if you want more details."),
      ).toBeInTheDocument();
    });

    it("parses and renders DataChart component with tabular data format", () => {
      const content = `<ui-component name="DataChart" props='{"columns":["month","visits"],"data":[{"month":"Oct","visits":250}]}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("data-chart")).toBeInTheDocument();
      expect(screen.getByTestId("mock-x-axis")).toHaveAttribute(
        "data-key",
        "month",
      );
      expect(screen.getByTestId("mock-bar-visits")).toBeInTheDocument();
    });

    it("parses and renders DataChart component with datasets/labels format and double-quoted props", () => {
      const content = `<ui-component name="DataChart" props='{"type":"bar","labels":["Mon","Tue"],"datasets":[{"label":"Hours","data":[6,8]}]}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("data-chart")).toBeInTheDocument();
      expect(screen.getByTestId("mock-bar-Hours")).toBeInTheDocument();
    });

    it("parses and renders Map component", () => {
      const content = `<ui-component name="Map" props='{"center":{"lat":35.68,"lng":139.76},"markers":[{"lat":35.68,"lng":139.76}]}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("mock-interactive-map")).toBeInTheDocument();
      expect(screen.getByTestId("mock-interactive-map")).toHaveAttribute(
        "data-lat",
        "35.68",
      );
    });

    it("renders fallback message for unknown component name", () => {
      const content = `<ui-component name="CryptoWallet" props='{"balance":100}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("ui-component-unknown")).toBeInTheDocument();
      expect(
        screen.getByText("Unknown component: CryptoWallet"),
      ).toBeInTheDocument();
    });

    it("renders parse error when component props JSON is invalid", () => {
      const content = `<ui-component name="DataTable" props='{invalid_json:}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("ui-component-parse-error")).toBeInTheDocument();
      expect(
        screen.getByText("Failed to parse props for DataTable"),
      ).toBeInTheDocument();
    });

    it("renders invalid data message when schema validation fails", () => {
      const content = `<ui-component name="Map" props='{"center":"invalid-not-an-object"}' />`;

      render(<MessageRenderer content={content} />);

      expect(screen.getByTestId("ui-component-invalid")).toBeInTheDocument();
      expect(screen.getByText("Invalid Map data")).toBeInTheDocument();
    });
  });
});
