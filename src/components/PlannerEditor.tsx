import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import type { Task, TaskInput, TaskStatus } from "../lib/tasks";
import { TRADES } from "../lib/tasks";
import { fmtDay, fmtShort } from "../lib/dates";
import type { ApiError } from "../lib/api";
import { IconClose, IconChevronDown, IconFlag, IconTrash, IconPlus } from "./icons";

const WIDTH = 320;
const MARGIN = 8;

export function tradeCls(trade: string) {
  return `ev-${TRADES.includes(trade) ? trade.toLowerCase().replace(/\s+/g, "-") : "other"}`;
}

function saneDate(v: string) {
  const y = +v.slice(0, 4);
  return y >= 2000 && y <= 2100;
}

/** Local copy of a value that resets whenever the source value changes. */
function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

/** Blur whatever is focused inside the panel so pending field edits commit
 *  before it unmounts. */
function closeWith(onClose: () => void) {
  return () => {
    (document.activeElement as HTMLElement | null)?.blur();
    onClose();
  };
}

/** A panel anchored beside `anchor` on desktop, or a bottom sheet on phones. */
function Panel({
  anchor,
  sheet,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  sheet: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = closeWith(onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (sheet || !el) return;
    const h = el.offsetHeight;
    let left = anchor.right + MARGIN;
    if (left + WIDTH > window.innerWidth - MARGIN) left = anchor.left - WIDTH - MARGIN;
    if (left < MARGIN) left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - WIDTH - MARGIN));
    let top = anchor.top - 6;
    if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    setPos({ top, left });
  }, [anchor, sheet]);

  // Escape closes from anywhere; a fixed panel doesn't follow the grid, so it
  // also closes when the page scrolls.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onResize = () => closeRef.current();
    window.addEventListener("keydown", onKey);
    if (!sheet) {
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [sheet]);

  if (sheet) {
    return (
      <div className="sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="sheet-panel pl-sheet" role="dialog" aria-modal="true" aria-label={label}>
          <div className="sheet-grab" />
          {children}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="menu-backdrop" onMouseDown={close} />
      <div
        ref={ref}
        className="pl-pop"
        role="dialog"
        aria-label={label}
        // Transparent (not hidden) until placed, so autofocus still lands.
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
      >
        {children}
      </div>
    </>
  );
}

const STATUSES: { key: TaskStatus; label: string; cls: string }[] = [
  { key: "todo", label: "To do", cls: "s-todo" },
  { key: "in_progress", label: "In progress", cls: "s-prog" },
  { key: "done", label: "Done", cls: "s-done" },
];

interface EditorProps {
  task: Task;
  anchor: DOMRect;
  sheet: boolean;
  /** Contractor: every field. Client: name and dates only (the API's rule). */
  full: boolean;
  areas: string[];
  onSave: (body: Partial<TaskInput>, label: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

export function TaskEditor({ task, anchor, sheet, full, areas, onSave, onDelete, onDuplicate, onClose }: EditorProps) {
  const [name, setName] = useDraft(task.name);
  const [progress, setProgress] = useDraft(task.progress);
  const [workers, setWorkers] = useDraft(String(task.workers));
  const [hours, setHours] = useDraft(String(task.hours));
  const [start, setStart] = useDraft(task.start_date);
  const [end, setEnd] = useDraft(task.end_date ?? "");
  const [err, setErr] = useState<string | null>(null);

  function commitName() {
    const v = name.trim();
    if (!v) return setName(task.name);
    if (v !== task.name) onSave({ name: v }, "Renamed task");
  }
  function commitNumber(field: "workers" | "hours", raw: string) {
    const n = Math.max(0, Number(raw) || 0);
    const v = field === "workers" ? Math.round(n) : n;
    if (v !== task[field]) onSave({ [field]: v }, field === "workers" ? "Changed crew size" : "Changed hours");
    else (field === "workers" ? setWorkers : setHours)(String(task[field]));
  }
  function commitDates(s: string, e: string) {
    const reset = () => {
      setStart(task.start_date);
      setEnd(task.end_date ?? "");
    };
    if (!s || !saneDate(s)) {
      setErr("Pick a valid start date.");
      return reset();
    }
    if (e && !saneDate(e)) {
      setErr("That finish date doesn't look right.");
      return reset();
    }
    if (e && e < s) {
      setErr("Finish can't be before the start.");
      return reset();
    }
    setErr(null);
    const body: Partial<TaskInput> = {};
    if (s !== task.start_date) body.start_date = s;
    if ((e || null) !== task.end_date) body.end_date = e || null;
    if (Object.keys(body).length) onSave(body, "Rescheduled task");
  }
  function commitProgress() {
    if (progress !== task.progress) onSave({ progress }, "Updated progress");
  }

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  const span = task.end_date && task.end_date !== task.start_date
    ? `${fmtShort(task.start_date)} → ${fmtShort(task.end_date)}`
    : fmtDay(task.start_date);

  return (
    <Panel anchor={anchor} sheet={sheet} label="Edit task" onClose={onClose}>
      <div className="pl-pop-head">
        <span className={`ev-bar ${tradeCls(task.trade)}`} />
        <div className="dt-main">
          <div className="pl-pop-title">{task.name}</div>
          <div className="dt-meta">{task.area} · {span}</div>
        </div>
        <button className="icon-btn" type="button" onClick={closeWith(onClose)} aria-label="Close">
          <IconClose />
        </button>
      </div>

      <div className="pl-pop-body">
        {err && <div className="error-banner">{err}</div>}
        <label className="field">
          <span className="label">Task</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={blurOnEnter} />
        </label>

        {full && (
          <div className="field">
            <span className="label">Status</span>
            <div className="pl-seg" role="group" aria-label="Status">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={s.cls}
                  aria-pressed={task.status === s.key}
                  onClick={() => task.status !== s.key && onSave({ status: s.key }, `Marked ${s.label.toLowerCase()}`)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="pl-slider">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                aria-label="Progress"
                onChange={(e) => setProgress(Number(e.target.value))}
                onPointerUp={commitProgress}
                onKeyUp={commitProgress}
                onBlur={commitProgress}
              />
              <b>{progress}%</b>
            </div>
          </div>
        )}

        {full && (
          <div className="form-row">
            <label className="field">
              <span className="label">Area</span>
              <div className="select-wrap">
                <select className="select" value={task.area} onChange={(e) => onSave({ area: e.target.value }, "Moved task")}>
                  {areas.map((a) => <option key={a}>{a}</option>)}
                </select>
                <IconChevronDown />
              </div>
            </label>
            <label className="field">
              <span className="label">Trade</span>
              <div className="select-wrap">
                <select className="select" value={task.trade || "Other"} onChange={(e) => onSave({ trade: e.target.value }, "Changed trade")}>
                  {TRADES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <IconChevronDown />
              </div>
            </label>
          </div>
        )}

        {full && (
          <div className="form-row">
            <label className="field">
              <span className="label">Workers</span>
              <input className="input mono" type="number" min={0} value={workers} onChange={(e) => setWorkers(e.target.value)} onBlur={(e) => commitNumber("workers", e.target.value)} onKeyDown={blurOnEnter} />
            </label>
            <label className="field">
              <span className="label">Hours</span>
              <input className="input mono" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} onBlur={(e) => commitNumber("hours", e.target.value)} onKeyDown={blurOnEnter} />
            </label>
          </div>
        )}

        <div className="form-row">
          <label className="field">
            <span className="label">Start</span>
            <input className="input mono" type="date" value={start} onChange={(e) => setStart(e.target.value)} onBlur={(e) => commitDates(e.target.value, end)} onKeyDown={blurOnEnter} />
          </label>
          <label className="field">
            <span className="label">Finish</span>
            <input className="input mono" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => commitDates(start, e.target.value)} onKeyDown={blurOnEnter} />
          </label>
        </div>

        {full ? (
          <button
            type="button"
            className="btn btn-secondary pl-flag"
            aria-pressed={task.priority === "high"}
            onClick={() => onSave({ priority: task.priority === "high" ? "normal" : "high" }, "Changed priority")}
          >
            <IconFlag />
            {task.priority === "high" ? "High priority" : "Flag as high priority"}
          </button>
        ) : (
          <dl className="pl-ro">
            <dt>Progress</dt><dd>{task.progress}%</dd>
            <dt>Trade</dt><dd>{task.trade || "—"}</dd>
            <dt>Crew</dt><dd>{task.workers} · {task.hours}h</dd>
          </dl>
        )}
      </div>

      <div className="pl-pop-foot">
        {full && (
          <>
            <button type="button" className="btn btn-secondary" onClick={onDuplicate}>
              <IconPlus />Duplicate
            </button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <IconTrash />Delete
            </button>
          </>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={closeWith(onClose)}>Done</button>
      </div>
    </Panel>
  );
}

export interface QuickTask {
  name: string;
  trade: string;
  workers: number;
  hours: number;
}

interface QuickAddProps {
  area: string;
  iso: string;
  anchor: DOMRect;
  sheet: boolean;
  defaultTrade: string;
  onAdd: (t: QuickTask) => Promise<void>;
  onClose: () => void;
}

/** Fast entry for one cell: type a name, press Enter, repeat. */
export function QuickAdd({ area, iso, anchor, sheet, defaultTrade, onAdd, onClose }: QuickAddProps) {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState(defaultTrade);
  const [workers, setWorkers] = useState("1");
  const [hours, setHours] = useState("8");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: FormEvent | KeyboardEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onAdd({ name: v, trade, workers: Math.max(0, Math.round(Number(workers) || 0)), hours: Math.max(0, Number(hours) || 0) });
      setName("");
      setAdded((n) => n + 1);
    } catch (e2) {
      setErr((e2 as ApiError)?.message ?? "Could not add task");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Panel anchor={anchor} sheet={sheet} label="Add task" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="pl-pop-head">
          <span className={`ev-bar ${tradeCls(trade)}`} />
          <div className="dt-main">
            <div className="pl-pop-title">Add to {area}</div>
            <div className="dt-meta">{fmtDay(iso)}</div>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="pl-pop-body">
          {err && <div className="error-banner">{err}</div>}
          <label className="field">
            <span className="label">Task</span>
            <input
              ref={inputRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                submit(e);
              }}
              placeholder="e.g. Wall plastering"
            />
          </label>
          <div className="pl-row3">
            <label className="field">
              <span className="label">Trade</span>
              <div className="select-wrap">
                <select className="select" value={trade} onChange={(e) => setTrade(e.target.value)}>
                  {TRADES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <IconChevronDown />
              </div>
            </label>
            <label className="field">
              <span className="label">Workers</span>
              <input className="input mono" type="number" min={0} value={workers} onChange={(e) => setWorkers(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Hours</span>
              <input className="input mono" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {added > 0 ? `${added} added — keep typing to add another.` : "Press Enter to add. The panel stays open for the next one."}
          </p>
        </div>
        <div className="pl-pop-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
