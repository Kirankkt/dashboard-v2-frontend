import { useState } from "react";
import type { TaskStatus } from "../lib/tasks";
import { Menu } from "./Menu";
import { ProgressPicker } from "./ProgressPicker";
import { useIsPhone } from "../lib/useIsPhone";
import { IconChevronDown } from "./icons";

const LABEL: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};
const CLS: Record<TaskStatus, string> = {
  todo: "pill-todo",
  in_progress: "pill-prog",
  done: "pill-done",
};
const ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

interface Props {
  value: TaskStatus;
  /** Current progress, used to prefill the picker. */
  progress?: number;
  /** The task's name, shown in the picker. */
  name?: string;
  editable: boolean;
  /** `progress` is set instead of `status` when the picker was used. */
  onChange: (s: TaskStatus, progress?: number) => void;
}

export function StatusControl({ value, progress = 0, name = "this task", editable, onChange }: Props) {
  const [pick, setPick] = useState<DOMRect | null>(null);
  const phone = useIsPhone();

  if (!editable) return <span className={`pill ${CLS[value]}`}>{LABEL[value]}</span>;

  return (
    <>
      <Menu
        triggerClassName={`pill pill-btn pill-caret ${CLS[value]}`}
        triggerLabel="Change status"
        align="start"
        trigger={<>{LABEL[value]}<IconChevronDown /></>}
      >
        {(close) =>
          ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={(e) => {
                // "In progress" asks how far along it is instead of guessing.
                if (s === "in_progress") setPick(e.currentTarget.getBoundingClientRect());
                else onChange(s);
                close();
              }}
            >
              <span className={`pill ${CLS[s]}`} style={{ pointerEvents: "none" }}>{LABEL[s]}</span>
            </button>
          ))
        }
      </Menu>
      {pick && (
        <ProgressPicker
          value={progress}
          name={name}
          anchor={pick}
          sheet={phone}
          onPick={(p) => {
            setPick(null);
            onChange("in_progress", p);
          }}
          onClose={() => setPick(null)}
        />
      )}
    </>
  );
}
