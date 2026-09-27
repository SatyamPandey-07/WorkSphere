"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Download, TrendingUp } from "lucide-react";

interface MonthlySpend {
  month: string;   // "Jan", "Feb", …
  amount: number;  // USD
}

const MOCK_SPENDING: MonthlySpend[] = [
  { month: "Jan", amount: 120 },
  { month: "Feb", amount: 95 },
  { month: "Mar", amount: 210 },
  { month: "Apr", amount: 175 },
  { month: "May", amount: 260 },
  { month: "Jun", amount: 190 },
  { month: "Jul", amount: 310 },
  { month: "Aug", amount: 280 },
  { month: "Sep", amount: 230 },
  { month: "Oct", amount: 0 },
  { month: "Nov", amount: 0 },
  { month: "Dec", amount: 0 },
];

const BAR_HEIGHT = 120;
const BAR_WIDTH = 22;
const GAP = 8;
const PADDING_X = 8;

function exportCSV(data: MonthlySpend[]) {
  const header = "Month,Amount (USD)";
  const rows = data.map((d) => `${d.month},${d.amount.toFixed(2)}`);
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "worksphere-monthly-spending.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MonthlySpendingChart() {
  const [data, setData] = useState<MonthlySpend[]>([]);

  useEffect(() => {
    // In production this would be `fetch("/api/user/spending?year=...")`.
    // Showing mock data scoped to the current year until the API is wired.
    const currentMonth = new Date().getMonth(); // 0-indexed
    setData(
      MOCK_SPENDING.map((d, i) => ({
        ...d,
        amount: i <= currentMonth ? d.amount : 0,
      })),
    );
  }, []);

  const maxAmount = useMemo(
    () => Math.max(...data.map((d) => d.amount), 1),
    [data],
  );

  const totalSpend = useMemo(
    () => data.reduce((sum, d) => sum + d.amount, 0),
    [data],
  );

  const svgWidth =
    data.length * (BAR_WIDTH + GAP) - GAP + PADDING_X * 2;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Monthly Spending
          </h2>
        </div>
        <button
          type="button"
          onClick={() => exportCSV(data)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
          title="Export spending as CSV"
          aria-label="Export monthly spending as CSV"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-4">
        <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Year-to-date
          </p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            ${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Monthly spending bar chart"
          width={svgWidth}
          height={BAR_HEIGHT + 24}
          className="min-w-full"
        >
          {data.map((d, idx) => {
            const barH =
              maxAmount > 0
                ? Math.round((d.amount / maxAmount) * BAR_HEIGHT)
                : 0;
            const x = PADDING_X + idx * (BAR_WIDTH + GAP);
            const y = BAR_HEIGHT - barH;

            return (
              <g key={d.month} role="graphics-symbol" aria-label={`${d.month}: $${d.amount}`}>
                {barH > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={BAR_WIDTH}
                    height={barH}
                    rx={3}
                    className="fill-blue-500 dark:fill-blue-400 hover:fill-blue-600 dark:hover:fill-blue-300 transition-colors"
                  >
                    <title>{d.month}: ${d.amount}</title>
                  </rect>
                )}
                {barH === 0 && (
                  <rect
                    x={x}
                    y={BAR_HEIGHT - 2}
                    width={BAR_WIDTH}
                    height={2}
                    rx={1}
                    className="fill-zinc-200 dark:fill-zinc-700"
                  />
                )}
                <text
                  x={x + BAR_WIDTH / 2}
                  y={BAR_HEIGHT + 16}
                  textAnchor="middle"
                  fontSize={9}
                  className="fill-zinc-500 dark:fill-zinc-400"
                >
                  {d.month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
