import { useState } from "react";
import type { FormEvent } from "react";
import type { Task, TaskInput, TaskStatus } from "../lib/tasks";
import { TRADES } from "../lib/tasks";
import type { ApiError } from "../lib/api";
import { IconClose, IconChevronDown } from "./icons";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  initial: Task | null;
  onClose: () => void;
  onSubmit: (data: TaskInput) => Promise<void>;
}

export function TaskModal({ initial, onClose, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [trade, setTrade] = useState(initial?.trade || TRADES[0]);
  const [workers, setWorkers] = useState(String(initial?.workers ?? 1));
  const [hours, setHours] = useState(String(initial?.hours ?? 8));
  const [startDate, setStartDate] = useState(initial?.start_date ?? todayISO());
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? "todo");
  const [progress, setProgress] = useState(String(initial?.progress ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        area: area.trim(),
        trade,
        workers: Number(workers) || 0,
        hours: Number(hours) || 0,
        start_date: startDate,
        end_date: endDate || null,
        status,
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      });
    } catch (err) {
      setError((err as ApiError)?.message ?? "Could not save task");
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={initial ? "Edit task" : "New task"}>
        <div className="modal-head">
          <h2>{initial ? "Edit task" : "New task"}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <form onSubmit={submit} style={{ display: "contents" }}>
          <div className="modal-body">
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="field">
              <label className="label" htmlFor="t-name">Task name</label>
              <input id="t-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Plumbing rough-in" />
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="t-area">Area</label>
                <input id="t-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} required placeholder="e.g. Kitchen" />
              </div>
              <div className="field">
                <label className="label" htmlFor="t-trade">Trade</label>
                <div className="select-wrap">
                  <select id="t-trade" className="select" value={trade} onChange={(e) => setTrade(e.target.value)}>
                    {TRADES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <IconChevronDown />
                </div>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="t-workers">Workers</label>
                <input id="t-workers" className="input" type="number" min="0" value={workers} onChange={(e) => setWorkers(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="t-hours">Hours</label>
                <input id="t-hours" className="input" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label className="label" htmlFor="t-start">Start date</label>
                <input id="t-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="t-end">End date</label>
                <input id="t-end" className="input" type="date" value={endDate ?? ""} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            {initial && (
              <div className="form-row">
                <div className="field">
                  <label className="label" htmlFor="t-status">Status</label>
                  <div className="select-wrap">
                    <select id="t-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                      <option value="todo">Todo</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                    <IconChevronDown />
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="t-prog">Progress %</label>
                  <input id="t-prog" className="input" type="number" min="0" max="100" value={progress} onChange={(e) => setProgress(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : initial ? "Save changes" : "Create task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
