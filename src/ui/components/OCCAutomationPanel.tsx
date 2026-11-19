import { MODE_TIER_ORDER, TRANSIT_MODES } from '../../config/modes';
import type { AutoHeadwayPolicy } from '../../core/contracts';
import { useGameStore } from '../store/useGameStore';

export function OCCAutomationPanel() {
  const telemetry = useGameStore((s) => s.telemetry);
  const activeRightPanel = useGameStore((s) => s.activeRightPanel);
  const toggleRightPanel = useGameStore((s) => s.toggleRightPanel);
  const setLinePolicy = useGameStore((s) => s.setLinePolicy);
  const recallVehicleToReserve = useGameStore((s) => s.recallVehicleToReserve);
  const upgradeCorridor = useGameStore((s) => s.upgradeCorridor);

  if (activeRightPanel !== 'OCC') {
    return null;
  }

  const reserveEntries = MODE_TIER_ORDER.map((mode) => ({
    mode,
    spec: TRANSIT_MODES[mode],
    count: telemetry.reservePoolByMode[mode] ?? 0,
  }));

  return (
    <aside className="pointer-events-auto fixed top-20 right-3 z-25 flex max-h-[68vh] w-96 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/92 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] font-semibold tracking-wider text-sky-400 uppercase">
            Operations Control Centre
          </div>
          <h3 className="text-sm font-semibold text-white">Auto-Headway &amp; Central Garage</h3>
        </div>
        <button
          type="button"
          onClick={() => toggleRightPanel('OCC')}
          className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close OCC panel"
        >
          &times;
        </button>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-950/65 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-wider text-slate-400 uppercase">
            Central Garage Reserve Pool
          </span>
          <span className="font-mono font-semibold text-emerald-300">
            {telemetry.reservePoolCount} idle ($0 redeploy)
          </span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 font-mono text-[10px]">
          {reserveEntries.map(({ mode, spec, count }) => (
            <div
              key={mode}
              className="rounded border border-slate-800 bg-slate-900/80 px-1 py-1 text-center"
              title={spec.name}
            >
              <div className="text-slate-400">T{spec.tier}</div>
              <div className={count > 0 ? 'font-bold text-emerald-300' : 'text-slate-500'}>
                {count}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        {telemetry.lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-3 text-slate-400">
            Create or stamp a transit corridor to configure automated headway and OpEx policies.
          </div>
        ) : (
          telemetry.lines.map((line) => {
            const spec = TRANSIT_MODES[line.mode];
            const tierIdx = MODE_TIER_ORDER.indexOf(line.mode);
            const nextModeId =
              tierIdx >= 0 && tierIdx + 1 < MODE_TIER_ORDER.length
                ? MODE_TIER_ORDER[tierIdx + 1]
                : null;
            const currentCap =
              line.policy.type === 'MANUAL'
                ? Math.max(500, line.dailyOpExCad * 3)
                : line.policy.maxDailyOpExCad;

            const switchPolicy = (type: AutoHeadwayPolicy['type']) => {
              if (type === 'MANUAL') {
                setLinePolicy(line.lineId, { type: 'MANUAL' });
              } else if (type === 'TARGET_LOAD') {
                setLinePolicy(line.lineId, {
                  type: 'TARGET_LOAD',
                  targetLoadPct: 80,
                  maxDailyOpExCad: currentCap,
                });
              } else {
                setLinePolicy(line.lineId, {
                  type: 'TARGET_HEADWAY',
                  headwaySec: Math.max(spec.minSafeHeadwaySec, 180),
                  maxDailyOpExCad: currentCap,
                });
              }
            };

            return (
              <div
                key={line.lineId}
                className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: line.color }}
                    />
                    <span className="truncate font-semibold text-white">{line.name}</span>
                  </div>
                  <div className="shrink-0 font-mono text-[10px] text-slate-300">
                    Load {line.avgLoadPct}% &bull; {line.actualHeadwaySec}s hw
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  {(['MANUAL', 'TARGET_LOAD', 'TARGET_HEADWAY'] as const).map((modeKey) => {
                    const active = line.policy.type === modeKey;
                    const label =
                      modeKey === 'MANUAL'
                        ? 'Manual'
                        : modeKey === 'TARGET_LOAD'
                          ? 'Target Load'
                          : 'Target Hw';
                    return (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => switchPolicy(modeKey)}
                        className={`rounded border py-1 font-medium transition ${
                          active
                            ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {line.policy.type === 'TARGET_LOAD' && (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="flex flex-col gap-1 text-slate-400">
                      <span>Load Target: {line.policy.targetLoadPct}%</span>
                      <input
                        type="range"
                        min={40}
                        max={95}
                        step={5}
                        value={line.policy.targetLoadPct}
                        onChange={(e) =>
                          setLinePolicy(line.lineId, {
                            type: 'TARGET_LOAD',
                            targetLoadPct: Number(e.target.value),
                            maxDailyOpExCad: currentCap,
                          })
                        }
                        className="accent-sky-400"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-slate-400">
                      <span>OpEx Cap ($/d)</span>
                      <input
                        type="number"
                        min={spec.dailyOpExPerUnit}
                        step={100}
                        value={line.policy.maxDailyOpExCad}
                        onChange={(e) =>
                          setLinePolicy(line.lineId, {
                            type: 'TARGET_LOAD',
                            targetLoadPct:
                              line.policy.type === 'TARGET_LOAD' ? line.policy.targetLoadPct : 80,
                            maxDailyOpExCad: Math.max(
                              spec.dailyOpExPerUnit,
                              Number(e.target.value) || spec.dailyOpExPerUnit,
                            ),
                          })
                        }
                        className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-slate-100"
                      />
                    </label>
                  </div>
                )}

                {line.policy.type === 'TARGET_HEADWAY' && (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="flex flex-col gap-1 text-slate-400">
                      <span>
                        Headway: {line.policy.headwaySec}s (min {spec.minSafeHeadwaySec}s)
                      </span>
                      <input
                        type="range"
                        min={30}
                        max={600}
                        step={15}
                        value={line.policy.headwaySec}
                        onChange={(e) =>
                          setLinePolicy(line.lineId, {
                            type: 'TARGET_HEADWAY',
                            headwaySec: Number(e.target.value),
                            maxDailyOpExCad: currentCap,
                          })
                        }
                        className="accent-sky-400"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-slate-400">
                      <span>OpEx Cap ($/d)</span>
                      <input
                        type="number"
                        min={spec.dailyOpExPerUnit}
                        step={100}
                        value={line.policy.maxDailyOpExCad}
                        onChange={(e) =>
                          setLinePolicy(line.lineId, {
                            type: 'TARGET_HEADWAY',
                            headwaySec:
                              line.policy.type === 'TARGET_HEADWAY' ? line.policy.headwaySec : 180,
                            maxDailyOpExCad: Math.max(
                              spec.dailyOpExPerUnit,
                              Number(e.target.value) || spec.dailyOpExPerUnit,
                            ),
                          })
                        }
                        className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-slate-100"
                      />
                    </label>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-mono text-slate-400">
                    Fleet {line.vehicleCount} &bull; OpEx ${line.dailyOpExCad}/d &bull; Floor{' '}
                    {spec.minSafeHeadwaySec}s
                  </span>
                  {line.vehicleCount > 1 && (
                    <button
                      type="button"
                      onClick={() => recallVehicleToReserve(line.lineId)}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                    >
                      Recall to Garage
                    </button>
                  )}
                </div>

                {line.governorState !== 'OK' && (
                  <div className="flex items-center justify-between gap-2 rounded border border-amber-500/50 bg-amber-950/50 px-2 py-1 text-[10px] text-amber-200">
                    <span>
                      {line.governorState === 'SAFE_HEADWAY'
                        ? `Clamped at ${spec.minSafeHeadwaySec}s safe headway floor.`
                        : 'Capped by daily OpEx governor.'}
                    </span>
                    {nextModeId && line.upgradeRecommended && (
                      <button
                        type="button"
                        onClick={() => upgradeCorridor(line.lineId, nextModeId)}
                        className="shrink-0 rounded bg-amber-400 px-1.5 py-0.5 font-semibold text-slate-950 hover:bg-amber-300"
                      >
                        Upgrade T{TRANSIT_MODES[nextModeId].tier}
                      </button>
                    )}
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
