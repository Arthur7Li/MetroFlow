import { TRANSIT_MODES } from '../../config/modes';
import { RIVER_CROSSING_SPECS, isModeAllowedOnCrossing } from '../../config/upgrades';
import type { CrossingType } from '../../core/contracts';
import { useGameStore } from '../store/useGameStore';

const CROSSING_OPTIONS: readonly CrossingType[] = ['ROAD_BRIDGE', 'TRANSIT_BRIDGE', 'TUNNEL'];

export function RiverCrossingModal() {
  const pending = useGameStore((s) => s.pendingRiverCrossing);
  const selectedMode = useGameStore((s) => s.selectedMode);
  const selectedPreset = useGameStore((s) => s.selectedPreset);
  const editingLineId = useGameStore((s) => s.editingLineId);
  const telemetry = useGameStore((s) => s.telemetry);
  const confirmRiverCrossing = useGameStore((s) => s.confirmRiverCrossing);
  const cancelRiverCrossing = useGameStore((s) => s.cancelRiverCrossing);

  if (!pending) {
    return null;
  }

  const editingLine =
    editingLineId !== null ? telemetry.lines.find((l) => l.lineId === editingLineId) : undefined;
  const activeMode = editingLine ? editingLine.mode : (selectedPreset?.mode ?? selectedMode);
  const modeSpec = TRANSIT_MODES[activeMode];

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-xs text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] font-semibold tracking-wider text-amber-400 uppercase">
              North Saskatchewan River Crossing
            </div>
            <h2 className="mt-0.5 text-base font-bold text-white">
              Select River Valley Engineering Option
            </h2>
            <p className="mt-1 text-slate-300">
              Spanning {pending.lengthKm} km with{' '}
              <span className="font-semibold text-sky-300">{modeSpec.name}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={cancelRiverCrossing}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            &times;
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {CROSSING_OPTIONS.map((type) => {
            const spec = RIVER_CROSSING_SPECS[type];
            const allowed = isModeAllowedOnCrossing(activeMode, type);
            const segCapEx = Math.round(
              pending.lengthKm * modeSpec.trackCapExPerKm * spec.costMultiplier,
            );

            return (
              <button
                key={type}
                type="button"
                disabled={!allowed}
                onClick={() => confirmRiverCrossing(type)}
                className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                  allowed
                    ? 'border-slate-700 bg-slate-950/70 hover:border-sky-400 hover:bg-slate-800/80'
                    : 'cursor-not-allowed border-slate-800 bg-slate-950/30 opacity-45'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{spec.label}</span>
                  <span className="font-mono text-xs font-bold text-emerald-300">
                    ${segCapEx.toLocaleString('en-CA')} CAD ({spec.costMultiplier.toFixed(1)}x)
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">{spec.description}</p>
                {!allowed && (
                  <p className="font-mono text-[10px] text-rose-300">
                    Incompatible with {modeSpec.name}.
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={cancelRiverCrossing}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-700"
          >
            Cancel Crossing Segment
          </button>
        </div>
      </div>
    </div>
  );
}
