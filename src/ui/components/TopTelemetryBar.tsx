import type { SimSpeed } from '../../core/contracts';
import { useGameStore } from '../store/useGameStore';

const SPEED_OPTIONS: Array<{ label: string; value: SimSpeed }> = [
  { label: 'Pause', value: 0 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

export function TopTelemetryBar() {
  const telemetry = useGameStore((s) => s.telemetry);
  const transportMode = useGameStore((s) => s.transportMode);
  const activeTool = useGameStore((s) => s.activeTool);
  const draftStopCount = useGameStore((s) => s.draftStopCount);
  const selectedLineId = useGameStore((s) => s.selectedLineId);
  const errorMessage = useGameStore((s) => s.errorMessage);

  const setSpeed = useGameStore((s) => s.setSpeed);
  const setActiveTool = useGameStore((s) => s.setActiveTool);
  const setSelectedLineId = useGameStore((s) => s.setSelectedLineId);
  const requestCommitDraft = useGameStore((s) => s.requestCommitDraft);
  const requestCancelDraft = useGameStore((s) => s.requestCancelDraft);
  const buyBusOnSelectedLine = useGameStore((s) => s.buyBusOnSelectedLine);

  return (
    <>
      <header className="pointer-events-auto fixed top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-900/85 px-4 py-2.5 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold tracking-wide text-slate-100">
              YEG Transit Architect <span className="text-xs font-normal text-sky-400">v0.1</span>
            </div>
            <div className="text-xs text-slate-400">
              Edmonton (YEG) &bull; Week {telemetry.simWeek}, Day {telemetry.simDay} &bull;{' '}
              <span className="font-mono text-slate-200">{telemetry.simHourMinute}</span>
            </div>
          </div>

          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
              transportMode === 'SAB'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
            title="Worker-to-Renderer snapshot transport mode"
          >
            {transportMode}
          </span>
        </div>

        <div className="flex items-center gap-5 text-xs">
          <div>
            <div className="text-slate-400">Treasury</div>
            <div className="font-mono text-sm font-semibold text-emerald-300">
              ${telemetry.treasuryCad.toLocaleString('en-CA')} CAD
            </div>
          </div>
          <div>
            <div className="text-slate-400">Daily Riders</div>
            <div className="font-mono text-sm font-semibold text-sky-300">
              {telemetry.dailyRidership.toLocaleString('en-CA')}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Mode Share</div>
            <div className="font-mono text-sm font-semibold text-slate-100">
              {telemetry.modeSharePct.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-slate-400">Approval</div>
            <div className="font-mono text-sm font-semibold text-amber-300">
              {telemetry.publicApprovalPct}%
            </div>
          </div>
          <div>
            <div className="text-slate-400">Lines / Fleet</div>
            <div className="font-mono text-sm font-semibold text-slate-100">
              {telemetry.lines.length} / {telemetry.activeVehicleCount}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-700/80 bg-slate-950/70 p-0.5">
            {SPEED_OPTIONS.map((opt) => {
              const active = telemetry.speed === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSpeed(opt.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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

          {activeTool === 'PAN' ? (
            <button
              type="button"
              onClick={() => setActiveTool('DRAW_BUS_LINE')}
              className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Draw Bus Line (B)
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={draftStopCount < 2}
                onClick={requestCommitDraft}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                Finish Line ({draftStopCount})
              </button>
              <button
                type="button"
                onClick={requestCancelDraft}
                className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={telemetry.lines.length === 0}
            onClick={buyBusOnSelectedLine}
            className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +1 Bus ($250)
          </button>
        </div>
      </header>

      {activeTool === 'DRAW_BUS_LINE' && (
        <div className="pointer-events-none fixed top-20 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-sky-500/40 bg-slate-900/90 px-3 py-1.5 text-xs text-sky-200 shadow-lg backdrop-blur">
          Click 2+ stations or map locations to draw a Local ETS Bus corridor. Double-click or press
          Enter to finish; Esc or right-click to cancel.
        </div>
      )}

      {errorMessage && (
        <div className="pointer-events-none fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-rose-500/50 bg-rose-950/90 px-3 py-1.5 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}

      {telemetry.lines.length > 0 && (
        <aside className="pointer-events-auto fixed bottom-3 left-3 z-20 flex max-w-sm flex-col gap-1.5 rounded-xl border border-slate-700/70 bg-slate-900/85 p-3 text-xs shadow-xl backdrop-blur-md">
          <div className="font-semibold uppercase tracking-wider text-slate-400">Active Routes</div>
          {telemetry.lines.map((line) => {
            const isSelected = selectedLineId === line.lineId;
            return (
              <button
                key={line.lineId}
                type="button"
                onClick={() => setSelectedLineId(line.lineId)}
                className={`flex items-center justify-between gap-4 rounded-lg border px-2.5 py-1.5 text-left transition ${
                  isSelected
                    ? 'border-sky-400/70 bg-slate-800/90'
                    : 'border-transparent bg-slate-950/50 hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-2 font-medium text-slate-100">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  {line.name}
                </span>
                <span className="font-mono text-slate-300">
                  {line.stationCount} stops &bull; {line.lengthKm} km &bull; {line.vehicleCount}{' '}
                  {line.vehicleCount === 1 ? 'bus' : 'buses'}
                </span>
              </button>
            );
          })}
        </aside>
      )}
    </>
  );
}
