import {
  CONCOURSE_UPGRADES,
  PARK_AND_RIDE_CAPEX_CAD,
  PARK_AND_RIDE_DAILY_OPEX_CAD,
  PARK_AND_RIDE_DEMAND_BONUS,
} from '../../config/upgrades';
import { useGameStore } from '../store/useGameStore';

interface StationInspectorTelemetry {
  kind: 'STATION';
  stationId: number;
  waitingCount: number;
}

export function StationInspectorModal() {
  const selectedStationId = useGameStore((s) => s.selectedStationId);
  const topology = useGameStore((s) => s.topology);
  const telemetry = useGameStore((s) => s.telemetry);
  const setSelectedStationId = useGameStore((s) => s.setSelectedStationId);
  const upgradeStationConcourse = useGameStore((s) => s.upgradeStationConcourse);
  const toggleParkAndRide = useGameStore((s) => s.toggleParkAndRide);

  if (selectedStationId === null || !topology) {
    return null;
  }

  const station = topology.stations.find((s) => s.stationId === selectedStationId);
  if (!station) {
    return null;
  }

  const inspectorData = telemetry.selectedInspectorData as StationInspectorTelemetry | null;
  const liveWaiting =
    inspectorData && inspectorData.kind === 'STATION' && inspectorData.stationId === station.stationId
      ? inspectorData.waitingCount
      : null;

  return (
    <aside className="pointer-events-auto fixed right-3 bottom-3 z-20 flex w-80 flex-col gap-3 rounded-xl border border-slate-700/80 bg-slate-900/92 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
              Zone {station.zone}
            </span>
            {station.subTag === 'ENTERTAINMENT' && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                ENT
              </span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-white">{station.name}</h3>
        </div>
        <button
          type="button"
          onClick={() => setSelectedStationId(null)}
          className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close station inspector"
        >
          &times;
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 font-mono text-[11px]">
        <div>
          <div className="text-[10px] text-slate-400">Demand</div>
          <div className="text-slate-100">{station.baseProduction.toLocaleString('en-CA')}/d</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Capacity K</div>
          <div className="text-slate-100">
            {station.carryingCapacity.toLocaleString('en-CA')}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Waiting</div>
          <div className="text-sky-300">{liveWaiting ?? '—'}</div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="font-semibold tracking-wider text-slate-400 uppercase">
          Unified Concourse Transfer Penalty
        </div>
        {([0, 1, 2] as const).map((tier) => {
          const spec = CONCOURSE_UPGRADES[tier];
          const isCurrent = station.concourseTier === tier;
          const costDelta = spec.capExCad - CONCOURSE_UPGRADES[station.concourseTier].capExCad;
          return (
            <button
              key={tier}
              type="button"
              disabled={isCurrent}
              onClick={() => upgradeStationConcourse(station.stationId, tier)}
              className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition ${
                isCurrent
                  ? 'border-sky-400/70 bg-sky-500/20 text-sky-100'
                  : 'border-slate-700/80 bg-slate-950/60 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <div>
                <div className="font-medium">
                  Tier {tier}: {spec.label}
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  {(spec.transferPenaltySec / 60).toFixed(1)} min transfer &bull; ${spec.dailyOpExCad}/d
                </div>
              </div>
              <div className="font-mono text-[11px] font-semibold">
                {isCurrent
                  ? 'Active'
                  : costDelta >= 0
                    ? `$${costDelta.toLocaleString('en-CA')}`
                    : `+$${Math.round(-costDelta * 0.75)}`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-slate-800 pt-2">
        <button
          type="button"
          onClick={() => toggleParkAndRide(station.stationId, !station.parkAndRideActive)}
          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition ${
            station.parkAndRideActive
              ? 'border-amber-400/70 bg-amber-500/20 text-amber-100'
              : 'border-slate-700 bg-slate-950/60 text-slate-200 hover:bg-slate-800'
          }`}
        >
          <div>
            <div className="font-semibold">
              Park-and-Ride Lot {station.parkAndRideActive ? '(Built)' : ''}
            </div>
            <div className="text-[10px] text-slate-300">
              +{PARK_AND_RIDE_DEMAND_BONUS} daily capture &bull; -15% TOD K (1 slot) &bull; $
              {PARK_AND_RIDE_DAILY_OPEX_CAD}/d
            </div>
          </div>
          <span className="font-mono text-[11px] font-semibold">
            {station.parkAndRideActive
              ? `Demolish (+$${Math.round(PARK_AND_RIDE_CAPEX_CAD * 0.75)})`
              : `$${PARK_AND_RIDE_CAPEX_CAD}`}
          </span>
        </button>
      </div>
    </aside>
  );
}
