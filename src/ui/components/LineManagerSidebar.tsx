import type { TransitModeId } from '../../cities/types';
import { MODE_TIER_ORDER, TRANSIT_MODES } from '../../config/modes';
import {
  ALL_DOOR_ARC_CAPEX_CAD,
  LRV_EXTRA_CAR_CAPEX_CAD,
  LRV_EXTRA_CAR_DAILY_OPEX_CAD,
  TSP_CAPEX_PER_KM_CAD,
  supportsMultiCarConsist,
} from '../../config/upgrades';
import { EDMONTON_LINE_PRESETS, useGameStore } from '../store/useGameStore';

const MODE_BADGE_SHORT: Record<TransitModeId, string> = {
  BUS_LOCAL: 'T1 BUS',
  BRT_ARTICULATED: 'T2 BRT',
  LRT_LOW_FLOOR: 'T3 TRAM',
  LRT_HIGH_FLOOR: 'T4 LRT',
  REGIONAL_RAIL: 'T5 RAIL',
};

export function LineManagerSidebar() {
  const telemetry = useGameStore((s) => s.telemetry);
  const activeTool = useGameStore((s) => s.activeTool);
  const selectedMode = useGameStore((s) => s.selectedMode);
  const selectedPreset = useGameStore((s) => s.selectedPreset);
  const selectedLineId = useGameStore((s) => s.selectedLineId);
  const draftStopCount = useGameStore((s) => s.draftStopCount);
  const editingLineId = useGameStore((s) => s.editingLineId);

  const setSelectedMode = useGameStore((s) => s.setSelectedMode);
  const setSelectedPreset = useGameStore((s) => s.setSelectedPreset);
  const setActiveTool = useGameStore((s) => s.setActiveTool);
  const setSelectedLineId = useGameStore((s) => s.setSelectedLineId);
  const undoDraftStop = useGameStore((s) => s.undoDraftStop);
  const requestCommitDraft = useGameStore((s) => s.requestCommitDraft);
  const requestCancelDraft = useGameStore((s) => s.requestCancelDraft);

  const buyVehicle = useGameStore((s) => s.buyVehicle);
  const sellVehicle = useGameStore((s) => s.sellVehicle);
  const setConsistCars = useGameStore((s) => s.setConsistCars);
  const toggleAllDoorArc = useGameStore((s) => s.toggleAllDoorArc);
  const toggleCorridorTsp = useGameStore((s) => s.toggleCorridorTsp);
  const upgradeCorridor = useGameStore((s) => s.upgradeCorridor);
  const startEditStopsForLine = useGameStore((s) => s.startEditStopsForLine);
  const removeLastStopFromLine = useGameStore((s) => s.removeLastStopFromLine);
  const deleteLine = useGameStore((s) => s.deleteLine);

  const activeSpec = TRANSIT_MODES[selectedMode];

  return (
    <aside className="pointer-events-auto fixed top-20 bottom-3 left-3 z-20 flex w-80 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900/88 p-3 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      <section className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-wider text-slate-300 uppercase">
            Corridor Builder
          </span>
          <span className="font-mono text-[11px] text-sky-400">
            ${activeSpec.trackCapExPerKm.toLocaleString('en-CA')}/km &bull; {activeSpec.cruiseSpeedKmh}{' '}
            km/h
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1">
          {MODE_TIER_ORDER.map((modeId) => {
            const spec = TRANSIT_MODES[modeId];
            const isActive = selectedMode === modeId;
            return (
              <button
                key={modeId}
                type="button"
                onClick={() => setSelectedMode(modeId)}
                className={`rounded-md border px-1 py-1.5 text-center font-mono text-[10px] font-semibold transition ${
                  isActive
                    ? 'border-sky-400 bg-sky-500/25 text-sky-200'
                    : 'border-slate-700/80 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                }`}
                title={`${spec.name} (${spec.capacityPerUnit}/unit, ${spec.cruiseSpeedKmh} km/h, $${spec.trackCapExPerKm}/km track, $${spec.vehicleCapEx} unit)`}
              >
                T{spec.tier}
              </button>
            );
          })}
        </div>

        <div className="rounded-md bg-slate-900/80 px-2 py-1.5 text-[11px] text-slate-300">
          <div className="font-medium text-slate-100">{activeSpec.name}</div>
          <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-400">
            <span>Cap {activeSpec.capacityPerUnit}</span>
            <span>Unit ${activeSpec.vehicleCapEx.toLocaleString('en-CA')}</span>
            <span>OpEx ${activeSpec.dailyOpExPerUnit}/d</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tracking-wide text-slate-400 uppercase">Presets:</span>
          {EDMONTON_LINE_PRESETS.map((preset) => {
            const active = selectedPreset?.badge === preset.badge;
            return (
              <button
                key={preset.badge}
                type="button"
                onClick={() => setSelectedPreset(active ? null : preset)}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
                  active
                    ? 'border-white/70 bg-slate-800 text-white'
                    : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                }`}
                title={`${preset.name} (${TRANSIT_MODES[preset.mode].name})`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
                {preset.badge}
              </button>
            );
          })}
        </div>

        {activeTool === 'PAN' ? (
          <button
            type="button"
            onClick={() => setActiveTool('DRAW_BUS_LINE')}
            className="w-full rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-slate-950 transition hover:bg-sky-400"
          >
            Draw {selectedPreset ? selectedPreset.name : activeSpec.name} (B)
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={draftStopCount < 2}
                onClick={requestCommitDraft}
                className="flex-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {editingLineId ? 'Save Stops' : 'Finish Route'} ({draftStopCount})
              </button>
              <button
                type="button"
                disabled={draftStopCount === 0}
                onClick={undoDraftStop}
                className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                title="Undo last stop (Backspace)"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={requestCancelDraft}
                className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="font-semibold tracking-wider text-slate-400 uppercase">
            Active Lines ({telemetry.lines.length})
          </span>
          <span className="font-mono text-[10px] text-slate-400">
            OpEx ${telemetry.dailyOpExCad.toLocaleString('en-CA')}/d
          </span>
        </div>

        {telemetry.lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700/80 bg-slate-950/40 p-3 text-[11px] text-slate-400">
            Select a transit mode above and click/drag between 2+ stations on the map to build your
            first corridor. Click any station in Pan mode to inspect Concourses &amp; Park-and-Ride.
          </div>
        ) : (
          telemetry.lines.map((line) => {
            const isSelected = selectedLineId === line.lineId;
            const spec = TRANSIT_MODES[line.mode];
            const perUnitCapEx =
              spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;
            const tierIdx = MODE_TIER_ORDER.indexOf(line.mode);
            const nextModeId =
              tierIdx >= 0 && tierIdx + 1 < MODE_TIER_ORDER.length
                ? MODE_TIER_ORDER[tierIdx + 1]
                : null;
            const tspCost = Math.round(line.lengthKm * TSP_CAPEX_PER_KM_CAD);

            return (
              <div
                key={line.lineId}
                className={`rounded-lg border transition ${
                  isSelected
                    ? 'border-sky-400/70 bg-slate-900/95'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedLineId(line.lineId)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: line.color }}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-100">{line.name}</div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {MODE_BADGE_SHORT[line.mode]} &bull; {line.stationCount} stops &bull;{' '}
                        {line.lengthKm} km
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[10px]">
                    <div className="text-sky-300">
                      {line.vehicleCount}x{line.consistCars > 1 ? `${line.consistCars}c` : '1'}{' '}
                    </div>
                    <div className="text-slate-400">${line.dailyOpExCad}/d</div>
                  </div>
                </button>

                {isSelected && (
                  <div className="flex flex-col gap-2 border-t border-slate-800/90 px-2.5 py-2 text-[11px]">
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => buyVehicle(line.lineId)}
                        className="flex-1 rounded bg-sky-500/20 px-2 py-1 font-medium text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/30"
                      >
                        +1 Unit (${perUnitCapEx.toLocaleString('en-CA')})
                      </button>
                      <button
                        type="button"
                        disabled={line.vehicleCount === 0}
                        onClick={() => sellVehicle(line.lineId)}
                        className="rounded bg-slate-800 px-2 py-1 font-medium text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700 disabled:opacity-40"
                        title={`Sell 1 unit (+75% CapEx refund: $${Math.round(perUnitCapEx * 0.75).toLocaleString('en-CA')})`}
                      >
                        -1
                      </button>
                    </div>

                    {supportsMultiCarConsist(line.mode) && (
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>LRV Consist Size ({spec.capacityPerUnit * line.consistCars}/train)</span>
                          <span>
                            +${LRV_EXTRA_CAR_CAPEX_CAD.toLocaleString('en-CA')} / +$
                            {LRV_EXTRA_CAR_DAILY_OPEX_CAD}/d
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {([1, 2, 3, 4] as const).map((cars) => (
                            <button
                              key={cars}
                              type="button"
                              onClick={() => setConsistCars(line.lineId, cars)}
                              className={`rounded border py-1 font-mono text-[10px] font-semibold ${
                                line.consistCars === cars
                                  ? 'border-sky-400 bg-sky-500/25 text-sky-200'
                                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                              }`}
                            >
                              {cars}-Car
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleAllDoorArc(line.lineId, !line.allDoorArc)}
                        className={`flex-1 rounded border px-2 py-1 text-[10px] font-medium ${
                          line.allDoorArc
                            ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                        title="Cuts passenger dwell time by 50%"
                      >
                        All-Door ARC {line.allDoorArc ? 'ON' : `($${ALL_DOOR_ARC_CAPEX_CAD})`}
                      </button>

                      {line.mode === 'LRT_LOW_FLOOR' && (
                        <button
                          type="button"
                          onClick={() => toggleCorridorTsp(line.lineId, !line.tspEnabled)}
                          className={`flex-1 rounded border px-2 py-1 text-[10px] font-medium ${
                            line.tspEnabled
                              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                          title="Removes at-grade signal delays (+$900/km)"
                        >
                          TSP Priority {line.tspEnabled ? 'ON' : `($${tspCost.toLocaleString('en-CA')})`}
                        </button>
                      )}
                    </div>

                    {nextModeId && (
                      <button
                        type="button"
                        onClick={() => upgradeCorridor(line.lineId, nextModeId)}
                        className="w-full rounded border border-amber-400/50 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25"
                      >
                        Upgrade to {TRANSIT_MODES[nextModeId].name}
                      </button>
                    )}

                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => startEditStopsForLine(line.lineId)}
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-800"
                      >
                        Edit Stops
                      </button>
                      {line.stationCount > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLastStopFromLine(line.lineId)}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
                          title="Trim terminal stop (+75% CapEx refund)"
                        >
                          Trim End
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteLine(line.lineId)}
                        className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-1 text-[10px] font-medium text-rose-200 hover:bg-rose-500/25"
                        title={`Demolish corridor (+75% CapEx refund: ~$${Math.round(line.totalCapExCad * 0.75).toLocaleString('en-CA')})`}
                      >
                        Demolish
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </aside>
  );
}
