export function ForecastLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 mt-2">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500" />
        <span>Predicted Noise (dB)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500" />
        <span>Quietest Hours</span>
      </div>
    </div>
  );
}
