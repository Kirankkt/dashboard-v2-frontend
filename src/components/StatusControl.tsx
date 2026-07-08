import { useState } from "react";
import type { TaskStatus } from "../lib/tasks";
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
  editable: boolean;
  onChange: (s: TaskStatus) => void;
}

export function StatusControl({ value, editable, onChange }: Props) {
  const [open, setOpen] = useState(false);

  if (!editable) return <span className={`pill ${CLS[value]}`}>{LABEL[value]}</span>;

  return (
    <span className="status-ctl">
      <button
        type="button"
        className={`pill pill-btn pill-caret ${CLS[value]}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
      >
        {LABEL[value]}
        <IconChevronDown />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            {ORDER.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className={`pill ${CLS[s]}`} style={{ pointerEvents: "none" }}>{LABEL[s]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
