import React, { useState } from 'react';

const EMISSION_FACTORS: Record<string, { label: string; gPerKm: number; icon: string }> = {
  walking: { label: 'Walking / Running', gPerKm: 0, icon: '🚶‍♂️' },
  bicycle: { label: 'Bicycle / E-Bike', gPerKm: 0, icon: '🚲' },
  scooter: { label: 'Electric Scooter', gPerKm: 15, icon: '🛴' },
  metro: { label: 'Public Metro / Train', gPerKm: 35, icon: '🚇' },
  car: { label: 'Gas Vehicle (Baseline)', gPerKm: 180, icon: '🚗' },
};

export const CarbonFootprintWidget: React.FC = () => {
  const [mode, setMode] = useState<string>('bicycle');
  const [distance, setDistance] = useState<number>(10);
  const [result, setResult] = useState<{ co2SavedKg: number; badgeEarned: string | null } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const calculateAndTrack = async () => {
    setIsSubmitting(true);
    try {
      // Baseline gas vehicle emissions for distance: 180g/km
      const baselineEmissionGrams = distance * EMISSION_FACTORS['car'].gPerKm;
      const chosenEmissionGrams = distance * EMISSION_FACTORS[mode].gPerKm;
      const savedGrams = Math.max(0, baselineEmissionGrams - chosenEmissionGrams);
      const co2SavedKg = Number((savedGrams / 1000).toFixed(2));

      // POST telemetry to backend
      const response = await fetch('/api/sustainability/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user_current',
          mode,
          distanceKm: distance,
          co2SavedKg,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setResult({
          co2SavedKg,
          badgeEarned: data.badgeStatus.unlockedBadge,
        });
      }
    } catch (e) {
      console.error('Failed to submit carbon telemetry', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-xl max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
        <h3 className="text-lg font-bold tracking-wide">Commute Carbon Calculator</h3>
        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/30">
          Eco-Nomad Rewards
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Select Transportation Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(EMISSION_FACTORS).map(([key, val]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`p-3 rounded-xl border text-left text-sm font-medium transition cursor-pointer flex items-center gap-2 ${
                  mode === key
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-800 bg-slate-800/50 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>{val.icon}</span>
                <span>{val.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Commute Distance: <span className="text-emerald-400 font-mono">{distance} km</span>
          </label>
          <input
            type="range"
            min="1"
            max="50"
            value={distance}
            onChange={(e) => setDistance(Number(e.target.value))}
            className="w-full accent-emerald-500 bg-slate-800 cursor-pointer"
          />
        </div>

        <button
          onClick={calculateAndTrack}
          disabled={isSubmitting}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition shadow-lg shadow-emerald-900/30 cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? 'Calculating & Syncing...' : 'Calculate & Log Carbon Savings'}
        </button>

        {result && (
          <div className="mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-2 animate-fadeIn">
            <div className="text-sm font-semibold text-emerald-400">
              🌱 CO₂ Saved: {result.co2SavedKg} kg on this trip!
            </div>
            {result.badgeEarned && (
              <div className="text-xs text-amber-300 font-medium">
                🏆 Digital Passport Badge Unlocked / Updated: <span className="font-bold">{result.badgeEarned}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CarbonFootprintWidget;