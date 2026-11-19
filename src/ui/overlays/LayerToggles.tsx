import type { HeatmapLayerMode } from '../../core/contracts';
import { useGameStore } from '../store/useGameStore';

const HEATMAP_OPTIONS: Array<{
  mode: HeatmapLayerMode;
  label: string;
  legend: string;
}> = [
  { mode: 'NONE', label: 'Map', legend: '' },
  { mode: 'CROWDING', label: 'Crowding', legend: 'Cyan (low) → Amber → Crimson (200+ waiting)' },
  { mode: 'LAND_VALUE', label: 'Land Value', legend: 'Emerald → Gold (TOD Tiers 1–5)' },
  { mode: 'HEADWAYS', label: 'Headways', legend: 'Green (on target) → Amber → Red (late/bunched)' },
  { mode: 'UNMET_CAR', label: 'Unmet Car', legend: 'Rose intensity (T_ij − D_ij auto demand)' },
];

export function LayerToggles() {
  const heatmapMode = useGameStore((s) => s.heatmapMode);
  const setHeatmapMode = useGameStore((s) => s.setHeatmapMode);

  const activeSpec = HEATMAP_OPTIONS.find((o) => o.mode === heatmapMode);

  return (
    <div className="pointer-events-auto fixed bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {activeSpec && activeSpec.legend && (
        <div className="rounded-md border border-slate-700/80 bg-slate-900/90 px-2.5 py-0.5 font-mono text-[10px] text-slate-200 shadow backdrop-blur">
          {activeSpec.legend}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/90 p-1 text-xs shadow-xl backdrop-blur-md">
        {HEATMAP_OPTIONS.map((opt) => {
          const active = heatmapMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => setHeatmapMode(opt.mode)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                active
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
