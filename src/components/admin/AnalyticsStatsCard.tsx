import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
}

export function AnalyticsStatsCard({ title, value, description }: StatsCardProps) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-400 mb-1">{title}</h3>
      <div className="text-3xl font-bold text-white mb-2">{value}</div>
      {description && <p className="text-xs text-gray-500">{description}</p>}
    </div>
  );
}
