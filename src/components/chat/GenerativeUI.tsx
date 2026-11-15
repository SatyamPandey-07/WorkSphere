import React, { Component, ErrorInfo, ReactNode } from "react";
import { z } from "zod";
import dynamic from "next/dynamic";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AlertCircle, BarChart2 } from "lucide-react";

const InteractiveMap = dynamic(() => import("./InteractiveMap"), {
  ssr: false,
});

// --- Error Boundary ---
export interface ErrorBoundaryProps {
  children: ReactNode;
  componentName: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `Error rendering generative component ${this.props.componentName}:`,
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="component-error-boundary"
          role="alert"
          className="flex items-center gap-2 p-3 my-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="flex flex-col">
            <span className="font-bold">
              Failed to render {this.props.componentName}
            </span>
            <span data-testid="error-message" className="text-xs opacity-80">
              {this.state.error?.message}
            </span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Dynamic Components ---

export interface DataChartProps {
  data?: any[];
  columns?: string[];
  type?: "bar" | "line" | "pie";
  labels?: string[];
  datasets?: Array<{ label: string; data: number[] }>;
}

export function DataChart({
  data: propData,
  columns: propColumns,
  labels,
  datasets,
}: DataChartProps) {
  let chartData: any[] = propData || [];
  let chartColumns: string[] = propColumns || [];

  // Transform labels and datasets into row objects if provided
  if (labels && datasets && (!chartData || chartData.length === 0)) {
    chartColumns = ["label", ...datasets.map((d) => d.label)];
    chartData = labels.map((lbl, i) => {
      const row: Record<string, any> = { label: lbl };
      datasets.forEach((d) => {
        row[d.label] = d.data?.[i] ?? 0;
      });
      return row;
    });
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div data-testid="data-chart-empty" className="text-zinc-500 text-xs my-2">
        No data available
      </div>
    );
  }

  // Derive columns if omitted
  if (!chartColumns || chartColumns.length === 0) {
    chartColumns = Object.keys(chartData[0] || {});
  }

  const xAxisKey = chartColumns[0] || "label";
  const dataKeys = chartColumns.slice(1);

  const accentHex =
    typeof window !== "undefined"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--primary-accent")
          .trim() || "#3b82f6"
      : "#3b82f6";

  return (
    <div
      data-testid="data-chart"
      className="w-full h-64 mt-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm"
    >
      <div className="flex items-center gap-2 mb-4 text-sm font-bold text-zinc-700 dark:text-zinc-300">
        <BarChart2 className="w-4 h-4 text-blue-500" />
        Data Visualization
      </div>
      <ResponsiveContainer width="99%" height="100%" debounce={50}>
        <BarChart
          data={chartData}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e5e7eb"
          />
          <XAxis
            dataKey={xAxisKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#6b7280" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#6b7280" }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              borderRadius: "12px",
              border: "none",
              boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
            }}
            cursor={{ fill: "rgba(0,0,0,0.05)" }}
          />
          {dataKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={i === 0 ? accentHex : i === 1 ? "#10b981" : "#f59e0b"}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DataTableProps {
  data?: any[];
  columns?: string[];
}

export function DataTable({ data = [], columns }: DataTableProps) {
  if (!data || data.length === 0) {
    return (
      <div data-testid="data-table-empty" className="text-zinc-500 text-xs my-2">
        No data to display
      </div>
    );
  }

  const safeColumns =
    columns && columns.length > 0
      ? columns
      : Object.keys(data[0] || {});

  return (
    <div
      data-testid="data-table"
      className="w-full mt-4 overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left" aria-label="Generated Data Table">
          <thead className="text-xs uppercase bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 font-black tracking-wider">
            <tr>
              {safeColumns.map((col) => (
                <th key={col} scope="col" className="px-4 py-3">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={i}
                data-testid={`data-table-row-${i}`}
                className="border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                {safeColumns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-3 text-zinc-700 dark:text-zinc-300 font-medium"
                  >
                    {row?.[col] !== undefined && row?.[col] !== null
                      ? String(row[col])
                      : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Parser & Renderer ---

function renderTextWithHighlight(
  text: string,
  keyPrefix: string,
  speakingSentenceIndex?: number | null,
  globalSentenceIndexRef?: { current: number },
) {
  if (speakingSentenceIndex === undefined || speakingSentenceIndex === null) {
    return (
      <span key={keyPrefix} className="whitespace-pre-wrap">
        {text}
      </span>
    );
  }

  const sentences = text.split(/(?<=[!?])\s+|(?<=(?<!\b\d+)\.)\s+/g);

  return (
    <span key={keyPrefix} className="whitespace-pre-wrap">
      {sentences.map((sent, i) => {
        const sentenceIdx = globalSentenceIndexRef
          ? globalSentenceIndexRef.current++
          : i;
        const isHighlighted = sentenceIdx === speakingSentenceIndex;

        return isHighlighted ? (
          <mark
            key={`${keyPrefix}-sent-${i}`}
            data-testid="text-highlight"
            className="bg-yellow-300 dark:bg-yellow-500/40 text-zinc-900 dark:text-zinc-50 font-semibold rounded px-1 py-0.5 shadow-sm border border-yellow-400/50 transition-all duration-200"
          >
            {sent}
          </mark>
        ) : (
          <span key={`${keyPrefix}-sent-${i}`}>{sent}</span>
        );
      })}
    </span>
  );
}

export interface MessageRendererProps {
  content?: string | null;
  speakingSentenceIndex?: number | null;
}

export function MessageRenderer({
  content,
  speakingSentenceIndex,
}: MessageRendererProps) {
  if (!content) return null;

  // Supports both props='{...}' and props="{...}" formats
  const regex = /<ui-component\s+name="([^"]+)"\s+props=(?:'([^']+)'|"([^"]+)")\s*\/>/g;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const sentenceCounter = { current: 0 };

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        renderTextWithHighlight(
          content.slice(lastIndex, match.index),
          `text-${lastIndex}`,
          speakingSentenceIndex,
          sentenceCounter,
        ),
      );
    }

    const componentName = match[1];
    const propsString = match[2] !== undefined ? match[2] : match[3];
    let props: Record<string, any> = {};

    try {
      const rawProps = (propsString || "")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&");
      props = JSON.parse(rawProps);
    } catch {
      console.error("Failed to parse component props", propsString);
      parts.push(
        <div
          key={`parse-err-${match.index}`}
          data-testid="ui-component-parse-error"
          className="text-red-500 text-xs mt-2"
        >
          Failed to parse props for {componentName}
        </div>,
      );
      lastIndex = regex.lastIndex;
      continue;
    }

    const componentSchemas: Record<string, z.ZodTypeAny> = {
      DataTable: z.object({
        columns: z.array(z.string()).optional(),
        data: z.array(z.record(z.string(), z.any())),
      }),
      DataChart: z.union([
        z.object({
          columns: z.array(z.string()).optional(),
          data: z.array(z.record(z.string(), z.any())),
        }),
        z.object({
          type: z.enum(["bar", "line", "pie"]).optional(),
          labels: z.array(z.string()),
          datasets: z.array(
            z.object({ label: z.string(), data: z.array(z.number()) }),
          ),
        }),
      ]),
      Map: z.object({
        center: z.object({ lat: z.number(), lng: z.number() }),
        markers: z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
      }),
    };

    const schema = componentSchemas[componentName];
    if (schema) {
      const result = schema.safeParse(props);
      if (!result.success) {
        console.error(`Invalid props for ${componentName}:`, result.error);
        parts.push(
          <div
            key={`invalid-${match.index}`}
            data-testid="ui-component-invalid"
            className="text-red-500 text-xs mt-2"
          >
            Invalid {componentName} data
          </div>,
        );
        lastIndex = regex.lastIndex;
        continue;
      }
      props = result.data as Record<string, any>;
    }

    let ComponentToRender: React.ComponentType<any> | null = null;
    if (componentName === "DataChart") ComponentToRender = DataChart;
    if (componentName === "Map") ComponentToRender = InteractiveMap;
    if (componentName === "DataTable") ComponentToRender = DataTable;

    if (ComponentToRender) {
      parts.push(
        <ComponentErrorBoundary
          key={`component-${match.index}`}
          componentName={componentName}
        >
          <ComponentToRender {...(props as any)} />
        </ComponentErrorBoundary>,
      );
    } else {
      parts.push(
        <div
          key={`unknown-${match.index}`}
          data-testid="ui-component-unknown"
          className="text-red-500 text-xs mt-2"
        >
          Unknown component: {componentName}
        </div>,
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(
      renderTextWithHighlight(
        content.slice(lastIndex),
        `text-${lastIndex}`,
        speakingSentenceIndex,
        sentenceCounter,
      ),
    );
  }

  return <>{parts}</>;
}

export default MessageRenderer;
