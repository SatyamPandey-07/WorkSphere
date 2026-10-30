import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface RadarChartSeries {
  name: string;
  color: string;
  values: number[];
}

export interface RadarChartProps {
  data?: RadarChartSeries[];
  labels?: string[];
  size?: number;
  className?: string;
  "data-testid"?: string;
}

export function RadarChart({
  data = [],
  labels = [],
  size = 300,
  className,
  "data-testid": dataTestId = "radar-chart",
}: RadarChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!labels || labels.length === 0) return null;

  const center = size / 2;
  const radius = (size / 2) * 0.7; // Leave room for labels
  const angleStep = (Math.PI * 2) / labels.length;

  // Calculate coordinates for a given value (0-100) and index
  const getCoordinatesForValue = (value: number, index: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const distance = (value / 100) * radius;
    return {
      x: center + distance * Math.cos(angle),
      y: center + distance * Math.sin(angle),
    };
  };

  // Generate SVG path string
  const generatePath = (values: number[]) => {
    return (
      values
        .map((val, i) => {
          const { x, y } = getCoordinatesForValue(val, i);
          return `${i === 0 ? "M" : "L"} ${x},${y}`;
        })
        .join(" ") + " Z"
    );
  };

  // Grid levels (e.g., 20, 40, 60, 80, 100)
  const gridLevels = [20, 40, 60, 80, 100];

  return (
    <div data-testid={dataTestId} className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="overflow-visible">
        {/* Background Grid */}
        {gridLevels.map((level) => (
          <polygon
            key={level}
            points={labels
              .map((_, i) => {
                const { x, y } = getCoordinatesForValue(level, i);
                return `${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-zinc-200 dark:text-zinc-800"
          />
        ))}

        {/* Axes */}
        {labels.map((_, i) => {
          const { x, y } = getCoordinatesForValue(100, i);
          return (
            <line
              key={`axis-${i}`}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth="1"
              className="text-zinc-200 dark:text-zinc-800"
            />
          );
        })}

        {/* Data Polygons with framer-motion */}
        {isMounted &&
          data.map((series, i) => {
            const path = generatePath(series.values);
            const zeroPath = generatePath(series.values.map(() => 0));

            return (
              <motion.path
                key={series.name}
                data-testid={`radar-series-${series.name.toLowerCase().replace(/\s+/g, '-')}`}
                initial={{ d: zeroPath, opacity: 0 }}
                animate={{ d: path, opacity: 0.5 }}
                transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.1 }}
                fill={series.color}
                stroke={series.color}
                strokeWidth="2"
              />
            );
          })}

        {/* Labels */}
        {labels.map((label, i) => {
          const { x, y } = getCoordinatesForValue(115, i); // Push labels slightly outside
          return (
            <text
              key={`label-${i}`}
              data-testid={`radar-label-${i}`}
              x={x}
              y={y}
              fill="currentColor"
              fontSize="12"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-zinc-600 dark:text-zinc-400"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default RadarChart;
