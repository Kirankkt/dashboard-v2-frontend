import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Menu } from "../components/Menu";
import { StatusControl } from "../components/StatusControl";
import { TaskModal } from "../components/TaskModal";
import { useAuth, canEdit as canEditFor } from "../auth/AuthContext";
import { IconTasks, IconPlus, IconRollover, IconMore, IconEdit, IconTrash, IconFlag, IconSearch, IconFilter, IconClose } from "../components/icons";
import { listTasks, createTask, updateTask, deleteTask, TRADES } from "../lib/tasks";
import { tradeCls } from "../components/PlannerEditor";
import type { Task, TaskStatus, TaskInput } from "../lib/tasks";
import { todayISO } from "../lib/dates";
import { saveError } from "../lib/api";
import type { ApiError } from "../lib/api";
import { SaveAlert } from "../components/SaveAlert";
import type { SaveFailure } from "../components/SaveAlert";

type Filter = "today" | "all" | "overdue" | TaskStatus;
const FILTERS: Filter[] = ["today", "all", "overdue", "todo", "in_progress", "done"];
const UNDO_LIMIT = 20;

/** What a task looked like before an edit, for the undo stack. */
function inputOf(t: Task): TaskInput {
  return {
    area: t.area,
    name: t.name,
    trade: t.trade,
    workers: t.workers,
    hours: t.hours,
    start_date: t.start_date,
    end_date: t.end_date,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
  };
}

function tradeOf(t: Task) {
  return TRADES.includes(t.trade) ? t.trade : "Other";
}
function dueOf(t: Task) {
  return t.end_date ?? t.start_date;
}
function toggleIn<T>(set: Set<T>, v: T) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function isOverdue(t: Task) {
  if (t.status === "done") return false;
  return (t.end_date ?? t.start_date) < todayISO();
}
// Active today: unfinished and its date range spans today — matches the
// dashboard's "Today" panel so the counts line up.
function isToday(t: Task) {
  if (t.status === "done") return false;
  const t0 = todayISO();
  return t.start_date <= t0 && (t.end_date ?? t.start_date) >= t0;
}

export default function Tasks() {
  const { token, user } = useAuth();
  const canEdit = canEditFor(user);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("filter") as Filter | null;
  const filter: Filter = raw && FILTERS.includes(raw) ? raw : "today";
  function setFilter(f: Filter) {
    setSearchParams(f === "today" ? {} : { filter: f }, { replace: true });
  }
  // Same shape of filtering as the Gantt: a search box plus a popover of
  // trades, areas, dates and priority, on top of the status chips.
  const [queryLive, setQueryLive] = useState("");
  const [query, setQuery] = useState("");
  const [fOpen, setFOpen] = useState(false);
  const [fTrades, setFTrades] = useState<Set<string>>(new Set());
  const [fAreas, setFAreas] = useState<Set<string>>(new Set());
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fHigh, setFHigh] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const undoRef = useRef<{ label: string; run: () => Promise<void> }[]>([]);
  const [undo, setUndo] = useState<string | null>(null);
  // A write that didn't land. Shown over the page until it's retried or
  // dismissed — losing a day's logging silently is the one thing we can't do.
  const [failure, setFailure] = useState<SaveFailure | null>(null);

  function pushUndo(label: string, run: () => Promise<void>) {
    undoRef.current = [...undoRef.current, { label, run }].slice(-UNDO_LIMIT);
    setUndo(label);
  }
  async function undoLast() {
    const entry = undoRef.current.pop();
    setUndo(undoRef.current[undoRef.current.length - 1]?.label ?? null);
    if (!entry) return;
    try {
      await entry.run();
      setFailure(null);
    } catch (e) {
      setFailure({ message: saveError(e, "That undo") });
      load();
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks(token));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(queryLive.trim().toLowerCase()), 160);
    return () => window.clearTimeout(id);
  }, [queryLive]);

  const allAreas = useMemo(
    () => [...new Set(tasks.map((t) => t.area))].sort((a, b) => a.localeCompare(b)),
    [tasks],
  );
  const allTrades = useMemo(
    () => [...new Set(tasks.map(tradeOf))].sort((a, b) => TRADES.indexOf(a) - TRADES.indexOf(b)),
    [tasks],
  );
  const nFilters = fTrades.size + fAreas.size + (fFrom ? 1 : 0) + (fTo ? 1 : 0) + (fHigh ? 1 : 0);

  // Everything except the status chip, so the chip counts say what picking one
  // would actually show.
  const pool = useMemo(
    () =>
      tasks.filter((t) => {
        if (query && !`${t.name} ${t.area} ${t.trade}`.toLowerCase().includes(query)) return false;
        if (fTrades.size && !fTrades.has(tradeOf(t))) return false;
        if (fAreas.size && !fAreas.has(t.area)) return false;
        if (fHigh && t.priority !== "high") return false;
        if (fFrom && dueOf(t) < fFrom) return false; // keep anything overlapping the window
        if (fTo && t.start_date > fTo) return false;
        return true;
      }),
    [tasks, query, fTrades, fAreas, fHigh, fFrom, fTo],
  );

  const counts = useMemo(() => {
    const c = { all: pool.length, today: 0, todo: 0, in_progress: 0, done: 0, overdue: 0 };
    for (const t of pool) {
      c[t.status]++;
      if (isOverdue(t)) c.overdue++;
      if (isToday(t)) c.today++;
    }
    return c;
  }, [pool]);
  const donePct = counts.all ? Math.round((counts.done / counts.all) * 100) : 0;

  const visible = useMemo(() => {
    if (filter === "all") return pool;
    if (filter === "today") return pool.filter(isToday);
    if (filter === "overdue") return pool.filter(isOverdue);
    return pool.filter((t) => t.status === filter);
  }, [pool, filter]);

  function clearFilters() {
    setFTrades(new Set());
    setFAreas(new Set());
    setFFrom("");
    setFTo("");
    setFHigh(false);
  }

  const replace = (u: Task) => setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x)));

  async function changeStatus(t: Task, status: TaskStatus, progress?: number) {
    try {
      // The picker sets a number; the server derives the status from it.
      replace(await updateTask(token, t.id, progress === undefined ? { status } : { progress }));
      setFailure(null);
      pushUndo(`status of “${t.name}”`, async () => replace(await updateTask(token, t.id, { progress: t.progress })));
    } catch (e) {
      setFailure({
        message: saveError(e, `“${t.name}”`),
        retry: () => changeStatus(t, status, progress),
      });
    }
  }
  async function submit(data: TaskInput) {
    setFailure(null);
    if (modal.task) {
      const before = inputOf(modal.task);
      const u = await updateTask(token, modal.task.id, data);
      replace(u);
      pushUndo(`changes to “${u.name}”`, async () => replace(await updateTask(token, u.id, before)));
    } else {
      const created = await createTask(token, data);
      setTasks((prev) => [...prev, created]);
      pushUndo(`adding “${created.name}”`, async () => {
        await deleteTask(token, created.id);
        setTasks((prev) => prev.filter((x) => x.id !== created.id));
      });
    }
    setModal({ open: false, task: null });
  }
  async function remove(t: Task) {
    if (!window.confirm(`Delete “${t.name}”?`)) return;
    try {
      await deleteTask(token, t.id);
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
      setFailure(null);
      pushUndo(`deleting “${t.name}”`, async () => {
        const back = await createTask(token, inputOf(t));
        setTasks((prev) => [...prev, back]);
      });
    } catch (e) {
      setFailure({ message: saveError(e, `Deleting “${t.name}”`), retry: () => remove(t) });
    }
  }

  const actions = canEdit ? (
    <>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={undoLast}
        disabled={!undo}
        title={undo ? `Undo ${undo}` : "Nothing to undo"}
      >
        <IconRollover />Undo
      </button>
      <button className="btn btn-primary" type="button" onClick={() => setModal({ open: true, task: null })}><IconPlus />Add task</button>
    </>
  ) : null;

  const chips: [Filter, string, number][] = [
    ["today", "Today", counts.today],
    ["all", "All", counts.all],
    ["overdue", "Overdue", counts.overdue],
    ["todo", "To do", counts.todo],
    ["in_progress", "In progress", counts.in_progress],
    ["done", "Done", counts.done],
  ];

  return (
    <AppShell title="Tasks" titleIcon={<IconTasks />} actions={actions}>
      {error && <div className="error-banner">{error}</div>}

      <div className="stat-row">
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--accent)" }} />Total tasks</div><div className="v">{counts.all}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--done-fg)" }} />Done</div><div className="v">{counts.done}<small>{donePct}%</small></div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--prog-fg)" }} />In progress</div><div className="v">{counts.in_progress}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--todo-fg)" }} />To do</div><div className="v">{counts.todo}</div></div>
        <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--danger)" }} />Overdue</div><div className="v">{counts.overdue}</div></div>
      </div>

      <div className="filter-bar">
        <div className="chips" role="group" aria-label="Filter by status">
          {chips.map(([key, label, n]) => (
            <button key={key} type="button" className="chip-btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
        </div>

        <div className="search-wrap g-search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search tasks, areas, trades…"
            value={queryLive}
            onChange={(e) => setQueryLive(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setQueryLive("");
              e.currentTarget.blur();
            }}
            aria-label="Search tasks"
          />
          {queryLive && (
            <button type="button" className="g-search-x" onClick={() => setQueryLive("")} aria-label="Clear search">
              <IconClose />
            </button>
          )}
        </div>

        <div className="g-filter-wrap">
          <button
            type="button"
            className={`btn btn-secondary g-filter-btn ${nFilters ? "on" : ""}`}
            onClick={() => setFOpen((v) => !v)}
            aria-expanded={fOpen}
          >
            <IconFilter />
            Filters
            {nFilters > 0 && <span className="panel-count">{nFilters}</span>}
          </button>
          {fOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setFOpen(false)} />
              <div className="g-pop">
                <div className="g-pop-head">
                  <b>Filters</b>
                  <button type="button" className="g-link" onClick={clearFilters} disabled={!nFilters}>
                    Clear all
                  </button>
                </div>

                <div className="g-pop-sec">
                  <label>Trade</label>
                  <div className="g-pop-tags">
                    {allTrades.map((tr) => (
                      <button
                        key={tr}
                        type="button"
                        className={`g-tag ${tradeCls(tr)}`}
                        aria-pressed={fTrades.has(tr)}
                        onClick={() => setFTrades((v) => toggleIn(v, tr))}
                      >
                        <i />
                        {tr}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="g-pop-sec">
                  <label>Priority</label>
                  <div className="g-pop-tags">
                    <button type="button" className="g-tag" aria-pressed={fHigh} onClick={() => setFHigh((v) => !v)}>
                      High priority only
                    </button>
                  </div>
                </div>

                <div className="g-pop-sec">
                  <label>Dates overlapping</label>
                  <div className="g-pop-dates">
                    <input
                      type="date"
                      className="input"
                      value={fFrom}
                      max={fTo || undefined}
                      onChange={(e) => setFFrom(e.target.value)}
                      aria-label="From date"
                    />
                    <span>to</span>
                    <input
                      type="date"
                      className="input"
                      value={fTo}
                      min={fFrom || undefined}
                      onChange={(e) => setFTo(e.target.value)}
                      aria-label="To date"
                    />
                  </div>
                </div>

                <div className="g-pop-sec">
                  <label>Area{fAreas.size > 0 && ` (${fAreas.size})`}</label>
                  <div className="g-pop-list">
                    {allAreas.map((a) => (
                      <label key={a} className="g-check">
                        <input type="checkbox" checked={fAreas.has(a)} onChange={() => setFAreas((v) => toggleIn(v, a))} />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="data-card">
        {loading ? (
          <div className="empty">Loading tasks…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <h3>
              {query || nFilters
                ? "Nothing matches these filters"
                : filter === "all"
                  ? "No tasks yet"
                  : filter === "today"
                    ? "Nothing scheduled for today"
                    : filter === "overdue"
                      ? "Nothing is overdue"
                      : "Nothing here"}
            </h3>
            <p className="hint">
              {query || nFilters ? (
                <button
                  type="button"
                  className="g-link"
                  onClick={() => {
                    clearFilters();
                    setQueryLive("");
                  }}
                >
                  Clear search and filters
                </button>
              ) : canEdit ? (
                "Add your first task to start planning the build."
              ) : (
                "Tasks will appear here once the contractor adds them."
              )}
            </p>
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl tbl-cards">
              <thead>
                <tr>
                  <th>Task</th><th>Area</th><th>Crew</th><th>Progress</th><th>Dates</th><th>Status</th>{canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Task">
                      <div className="t-name">
                        {t.priority === "high" && <span className="prio-badge"><IconFlag />High</span>}
                        {t.name}
                      </div>
                      <div className="t-sub">{t.trade || "—"}</div>
                    </td>
                    <td data-label="Area">{t.area}</td>
                    <td data-label="Crew" className="num">{t.workers} · {t.hours}h</td>
                    <td data-label="Progress" style={{ minWidth: 120 }}>
                      <div className={`progress ${t.progress >= 100 ? "is-done" : ""}`}><span style={{ width: `${t.progress}%` }} /></div>
                    </td>
                    <td data-label="Dates" className="num">
                      {fmtDate(t.start_date)}
                      {t.end_date && t.end_date !== t.start_date ? ` → ${fmtDate(t.end_date)}` : ""}
                      {isOverdue(t) && <span style={{ color: "var(--danger)", marginLeft: 6 }} title="Overdue">!</span>}
                    </td>
                    <td data-label="Status"><StatusControl value={t.status} progress={t.progress} name={t.name} editable={!!canEdit} onChange={(s, p) => changeStatus(t, s, p)} /></td>
                    {canEdit && (
                      <td className="td-actions">
                        <Menu triggerClassName="row-more" triggerLabel="Row actions" trigger={<IconMore />}>
                          {(close) => (
                            <>
                              <button type="button" onClick={() => { setModal({ open: true, task: t }); close(); }}><IconEdit />Edit</button>
                              <div className="menu-sep" />
                              <button type="button" className="danger" onClick={() => { close(); remove(t); }}><IconTrash />Delete</button>
                            </>
                          )}
                        </Menu>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.open && (
        <TaskModal initial={modal.task} onClose={() => setModal({ open: false, task: null })} onSubmit={submit} />
      )}

      <SaveAlert failure={failure} onDismiss={() => setFailure(null)} />
    </AppShell>
  );
}
