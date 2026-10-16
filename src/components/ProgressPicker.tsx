import { useState } from "react";
import { Panel } from "./PlannerEditor";

const PRESETS = [10, 25, 50, 75, 90];

/** Asks how far along a task is. A preset is one tap; the slider covers the
 * rest. Opens as a bottom sheet on phones. */
export function ProgressPicker({
  value,
  name,
  anchor,
  sheet,
  onPick,
  onClose,
}: {
  value: number;
  name: string;
  anchor: DOMRect;
  sheet: boolean;
  onPick: (progress: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value > 0 && value < 100 ? value : 10);
  return (
    <Panel anchor={anchor} sheet={sheet} label="Set progress" onClose={onClose}>
      <div className="pl-pop-head">
        <div className="pl-pop-title">How far along is “{name}”?</div>
      </div>
      <div className="pl-pop-body">
        <div className="pp-presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="g-tag" aria-pressed={draft === p} onClick={() => onPick(p)}>
              {p}%
            </button>
          ))}
        </div>
        <div className="pl-slider">
          <input
            type="range"
            min={5}
            max={95}
            step={5}
            value={draft}
            aria-label="Progress"
            onChange={(e) => setDraft(Number(e.target.value))}
          />
          <b>{draft}%</b>
        </div>
      </div>
      <div className="pl-pop-foot">
        <span className="spacer" />
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => onPick(draft)}>Save</button>
      </div>
    </Panel>
  );
}
