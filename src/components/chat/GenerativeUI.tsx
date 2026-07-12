import React, { Component, ErrorInfo, ReactNode } from "react";
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

const InteractiveMap = dynamic(() => import("./InteractiveMap"), { ssr: false });

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
  componentName: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error rendering generative component ${this.props.componentName}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 p-3 my-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="flex flex-col">
            <span className="font-bold">Failed to render {this.props.componentName}</span>
            <span className="text-xs opacity-80">{this.state.error?.message}</span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Dynamic Components ---

export function DataChart({ data, columns }: { data: any[]; columns: string[] }) {
  if (!data || data.length === 0) return <div>No data available</div>;

  const xAxisKey = columns[0];
  const dataKeys = columns.slice(1);

  return (
    <div className="w-full h-64 mt-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2 mb-4 text-sm font-bold text-zinc-700 dark:text-zinc-300">
        <BarChart2 className="w-4 h-4 text-blue-500" />
        Data Visualization
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey={xAxisKey} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} />
          <Tooltip 
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
          />
          {dataKeys.map((key, i) => (
            <Bar 
              key={key} 
              dataKey={key} 
              fill={i === 0 ? "#3b82f6" : i === 1 ? "#10b981" : "#f59e0b"} 
              radius={[4, 4, 0, 0]} 
              maxBarSize={40}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}



export function DataTable({ data, columns }: { data: any[]; columns: string[] }) {
  if (!data || data.length === 0) return <div>No data to display</div>;
  
  return (
    <div className="w-full mt-4 overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 font-black tracking-wider">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-4 py-3">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                {columns.map((col) => (
                  <td key={col} className="px-4 py-3 text-zinc-700 dark:text-zinc-300 font-medium">
                    {row[col]}
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

export function MessageRenderer({ content }: { content: string }) {
  // We use a regex to find <ui-component name="..." props='{...}' />
  const regex = /<ui-component\s+name="([^"]+)"\s+props='([^']+)'\s*\/>/g;
  
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
          {content.slice(lastIndex, match.index)}
        </span>
      );
    }

    const componentName = match[1];
    let props = {};
    try {
      // Decode HTML entities if AI escaped them
      const rawProps = match[2].replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
      props = JSON.parse(rawProps);
    } catch {
      console.error("Failed to parse component props", match[2]);
    }

    let ComponentToRender = null;
    if (componentName === "DataChart") ComponentToRender = DataChart;
    if (componentName === "Map") ComponentToRender = InteractiveMap;
    if (componentName === "DataTable") ComponentToRender = DataTable;

    if (ComponentToRender) {
      parts.push(
        <ComponentErrorBoundary key={`component-${match.index}`} componentName={componentName}>
          <ComponentToRender {...(props as any)} />
        </ComponentErrorBoundary>
      );
    } else {
      parts.push(
        <div key={`unknown-${match.index}`} className="text-red-500 text-xs mt-2">
          Unknown component: {componentName}
        </div>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(
      <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
        {content.slice(lastIndex)}
      </span>
    );
  }

  return <>{parts}</>;
}
