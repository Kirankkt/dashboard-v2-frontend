import type { TaskStatus } from "../lib/tasks";
import { Menu } from "./Menu";
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
  if (!editable) return <span className={`pill ${CLS[value]}`}>{LABEL[value]}</span>;

  return (
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
            onClick={() => {
              onChange(s);
              close();
            }}
          >
            <span className={`pill ${CLS[s]}`} style={{ pointerEvents: "none" }}>{LABEL[s]}</span>
          </button>
        ))
      }
    </Menu>
  );
}
