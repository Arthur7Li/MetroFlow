import { INTERCHANGE_BLUEPRINTS } from '../../config/upgrades';
import { useGameStore } from '../store/useGameStore';

export function BlueprintPalette() {
  const activeRightPanel = useGameStore((s) => s.activeRightPanel);
  const activeBlueprintId = useGameStore((s) => s.activeBlueprintId);
  const toggleRightPanel = useGameStore((s) => s.toggleRightPanel);
  const selectBlueprintToStamp = useGameStore((s) => s.selectBlueprintToStamp);

  if (activeRightPanel !== 'BLUEPRINTS') {
    return null;
  }

  return (
    <aside className="pointer-events-auto fixed top-20 right-3 z-25 flex w-80 flex-col gap-3 rounded-xl border border-slate-700/80 bg-slate-900/92 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">
            Blueprint Interchanges
          </div>
          <h3 className="text-sm font-semibold text-white">One-Click Hub Templates</h3>
        </div>
        <button
          type="button"
          onClick={() => toggleRightPanel('BLUEPRINTS')}
          className="rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close blueprints panel"
        >
          &times;
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {INTERCHANGE_BLUEPRINTS.map((bp) => {
          const isArmed = activeBlueprintId === bp.id;
          return (
            <button
              key={bp.id}
              type="button"
              onClick={() => selectBlueprintToStamp(isArmed ? null : bp.id)}
              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition ${
                isArmed
                  ? 'border-cyan-400 bg-cyan-500/20 text-white'
                  : 'border-slate-700/80 bg-slate-950/65 text-slate-200 hover:border-slate-500 hover:bg-slate-800/70'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{bp.name}</span>
                <span className="font-mono text-[11px] font-semibold text-emerald-300">
                  ${bp.capExCad.toLocaleString('en-CA')}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">{bp.description}</p>
              {isArmed && (
                <div className="mt-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                  Click any map point or hub to stamp (Esc/Right-click to cancel)
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
