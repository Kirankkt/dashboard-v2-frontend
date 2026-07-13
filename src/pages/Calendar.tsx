import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Menu } from "../components/Menu";
import { StatusControl } from "../components/StatusControl";
import { TaskModal } from "../components/TaskModal";
import { useAuth } from "../auth/AuthContext";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconClose,
  IconMore,
  IconEdit,
  IconTrash,
  IconFlag,
} from "../components/icons";
import { listTasks, createTask, updateTask, deleteTask, TRADES } from "../lib/tasks";
import type { Task, TaskStatus, TaskInput } from "../lib/tasks";
import { isoOf, todayISO, fmtMonth } from "../lib/dates";
import type { ApiError } from "../lib/api";

type View = "month" | "list";

const MAX_SPAN_DAYS = 90; // safety cap when expanding start→end ranges into days

function tradeCls(trade: string) {
  return `ev-${TRADES.includes(trade) ? trade.toLowerCase().replace(/\s+/g, "-") : "other"}`;
}

/** Every day an active task occupies, capped for safety. */
function* spanDays(t: Task): Generator<string> {
  const start = new Date(t.start_date + "T00:00:00");
  const end = t.end_date ? new Date(t.end_date + "T00:00:00") : start;
  for (let i = 0, d = new Date(start); d <= end && i < MAX_SPAN_DAYS; i++, d.setDate(d.getDate() + 1)) {
    yield isoOf(d);
  }
}

export default function Calendar() {
  const { token, user } = useAuth();
  const canEdit = user?.role === "contractor";
  const today = todayISO();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phones default to the agenda — the month grid needs horizontal scroll there.
  const [view, setView] = useState<View>(() => (window.innerWidth <= 700 ? "list" : "month"));
  const [query, setQuery] = useState("");
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [modal, setModal] = useState<{ open: boolean; task: Task | null; date?: string }>({ open: false, task: null });
  const [dayPanel, setDayPanel] = useState<string | null>(null);

  useEffect(() => {
    listTasks(token)
      .then(setTasks)
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load tasks"))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.area.toLowerCase().includes(q) ||
        t.trade.toLowerCase().includes(q),
    );
  }, [tasks, query]);

  // 6 fixed weeks starting on the Sunday on/before the 1st.
  const grid = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const cells: { iso: string; day: number; inMonth: boolean }[] = [];
    const d = new Date(start);
    for (let i = 0; i < 42; i++) {
      cells.push({ iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === ym.m });
      d.setDate(d.getDate() + 1);
    }
    return cells;
  }, [ym]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filtered) {
      for (const iso of spanDays(t)) {
        const arr = map.get(iso);
        if (arr) arr.push(t);
        else map.set(iso, [t]);
      }
    }
    const rank = (t: Task) => (t.priority === "high" ? 0 : 1) + (t.status === "done" ? 2 : 0);
    for (const arr of map.values()) arr.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    return map;
  }, [filtered]);

  const monthTrades = useMemo(() => {
    const set = new Set<string>();
    for (const c of grid) {
      if (!c.inMonth) continue;
      for (const t of byDay.get(c.iso) ?? []) set.add(TRADES.includes(t.trade) ? t.trade : "Other");
    }
    return [...set].sort();
  }, [grid, byDay]);

  const agenda = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const t of [...filtered].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id)) {
      const arr = groups.get(t.start_date);
      if (arr) arr.push(t);
      else groups.set(t.start_date, [t]);
    }
    return [...groups.entries()];
  }, [filtered]);

  function move(delta: number) {
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }
  function goToday() {
    const d = new Date();
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  }

  async function changeStatus(t: Task, status: TaskStatus) {
    try {
      const u = await updateTask(token, t.id, { status });
      setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not update status");
    }
  }
  async function submit(data: TaskInput) {
    if (modal.task) {
      const u = await updateTask(token, modal.task.id, data);
      setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } else {
      const created = await createTask(token, data);
      setTasks((prev) => [...prev, created]);
    }
    setModal({ open: false, task: null });
  }
  async function remove(t: Task) {
    if (!window.confirm(`Delete “${t.name}”? This can't be undone.`)) return;
    try {
      await deleteTask(token, t.id);
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not delete task");
    }
  }

  const weekdays = useMemo(() => {
    const base = new Date(2026, 0, 4); // a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: "short" });
    });
  }, []);

  const actions = canEdit ? (
    <button className="btn btn-primary" type="button" onClick={() => setModal({ open: true, task: null })}>
      <IconPlus />New task
    </button>
  ) : null;

  const panelTasks = dayPanel ? byDay.get(dayPanel) ?? [] : [];

  return (
    <AppShell title="Calendar" titleIcon={<IconCalendar />} actions={actions}>
      {error && <div className="error-banner">{error}</div>}

      <div className="cal-bar">
        <div className="cal-nav">
          <button className="icon-btn" type="button" aria-label="Previous month" onClick={() => move(-1)}><IconChevronLeft /></button>
          <button className="btn btn-secondary" type="button" onClick={goToday}>Today</button>
          <button className="icon-btn" type="button" aria-label="Next month" onClick={() => move(1)}><IconChevronRight /></button>
          <h2 className="cal-month">{fmtMonth(ym.y, ym.m)}</h2>
        </div>
        <div className="spacer" />
        <div className="search-wrap">
          <IconSearch />
          <input
            className="input"
            type="search"
            placeholder="Search tasks, areas, trades…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        <div className="chips" role="group" aria-label="View">
          <button type="button" className="chip-btn" aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
          <button type="button" className="chip-btn" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
        </div>
      </div>

      {loading ? (
        <div className="data-card"><div className="empty">Loading calendar…</div></div>
      ) : view === "month" ? (
        <>
          {monthTrades.length > 0 && (
            <div className="cal-legend">
              {monthTrades.map((tr) => (
                <span key={tr} className={`legend-item ${tradeCls(tr)}`}><i />{tr}</span>
              ))}
            </div>
          )}
          <div className="data-card">
            <div className="cal-scroll">
              <div className="cal">
                <div className="cal-week-head">
                  {weekdays.map((w) => <div key={w}>{w}</div>)}
                </div>
                <div className="cal-grid">
                  {grid.map((c) => {
                    const dayTasks = byDay.get(c.iso) ?? [];
                    const extra = dayTasks.length - 3;
                    return (
                      <div key={c.iso} className={`cal-cell ${c.inMonth ? "" : "dim"} ${c.iso === today ? "today" : ""}`}>
                        <div className="cal-cell-top">
                          {canEdit && (
                            <button
                              className="cal-add"
                              type="button"
                              aria-label={`Add task on ${c.iso}`}
                              onClick={() => setModal({ open: true, task: null, date: c.iso })}
                            >
                              <IconPlus />
                            </button>
                          )}
                          <span className="cal-daynum">{c.day}</span>
                        </div>
                        {dayTasks.slice(0, 3).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`ev ${tradeCls(t.trade)} ${t.status === "done" ? "ev-done" : ""} ${t.priority === "high" ? "ev-high" : ""}`}
                            title={`${t.name} — ${t.area}`}
                            onClick={() => setDayPanel(c.iso)}
                          >
                            {t.name}
                          </button>
                        ))}
                        {extra > 0 && (
                          <button type="button" className="ev-more" onClick={() => setDayPanel(c.iso)}>
                            +{extra} more
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="data-card">
          {agenda.length === 0 ? (
            <div className="empty">
              <h3>{query ? "No matching tasks" : "No tasks yet"}</h3>
              <p className="hint">{query ? "Try a different search." : "Scheduled work will appear here."}</p>
            </div>
          ) : (
            <div className="agenda">
              {agenda.map(([date, items]) => (
                <section key={date} className={`agenda-group ${date === today ? "is-today" : ""}`}>
                  <header className="agenda-date">
                    <span className="mono">
                      {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                    {date === today && <span className="today-tag">Today</span>}
                    {date < today && items.some((t) => t.status !== "done") && <span className="late">overdue</span>}
                  </header>
                  {items.map((t) => (
                    <div key={t.id} className="agenda-row">
                      <span className={`ev-bar ${tradeCls(t.trade)}`} />
                      <div className="dt-main">
                        <div className="dt-name">
                          {t.priority === "high" && <span className="prio-badge"><IconFlag />High priority</span>}
                          {t.name}
                        </div>
                        <div className="dt-meta">
                          {t.area} · {t.trade || "—"} · {t.workers}w · {t.hours}h
                          {t.end_date && t.end_date !== t.start_date ? ` · until ${t.end_date.slice(8)}/${t.end_date.slice(5, 7)}` : ""}
                        </div>
                      </div>
                      <div className={`progress agenda-prog ${t.progress >= 100 ? "is-done" : ""}`}><span style={{ width: `${t.progress}%` }} /></div>
                      <StatusControl value={t.status} editable={!!canEdit} onChange={(s) => changeStatus(t, s)} />
                      {canEdit && (
                        <Menu triggerClassName="row-more" triggerLabel="Task actions" trigger={<IconMore />}>
                          {(close) => (
                            <>
                              <button type="button" onClick={() => { setModal({ open: true, task: t }); close(); }}><IconEdit />Edit</button>
                              <div className="menu-sep" />
                              <button type="button" className="danger" onClick={() => { close(); remove(t); }}><IconTrash />Delete</button>
                            </>
                          )}
                        </Menu>
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {dayPanel && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDayPanel(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Day details">
            <div className="modal-head">
              <h2>{new Date(dayPanel + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h2>
              <button className="icon-btn" type="button" onClick={() => setDayPanel(null)} aria-label="Close"><IconClose /></button>
            </div>
            <div className="modal-body">
              {panelTasks.length === 0 ? (
                <div className="empty">No tasks on this day.</div>
              ) : (
                panelTasks.map((t) => (
                  <div key={t.id} className="day-task">
                    <span className={`ev-bar ${tradeCls(t.trade)}`} />
                    <div className="dt-main">
                      <div className="dt-name">
                        {t.priority === "high" && <span className="prio-badge"><IconFlag />High priority</span>}
                        {t.name}
                      </div>
                      <div className="dt-meta">{t.area} · {t.trade || "—"} · {t.workers}w · {t.hours}h</div>
                      <div className={`progress day-prog ${t.progress >= 100 ? "is-done" : ""}`}><span style={{ width: `${t.progress}%` }} /></div>
                    </div>
                    <div className="day-task-side">
                      <StatusControl value={t.status} editable={!!canEdit} onChange={(s) => changeStatus(t, s)} />
                      {canEdit && (
                        <div className="day-task-btns">
                          <button className="icon-btn" type="button" aria-label="Edit" onClick={() => { setDayPanel(null); setModal({ open: true, task: t }); }}><IconEdit /></button>
                          <button className="icon-btn" type="button" aria-label="Delete" onClick={() => remove(t)}><IconTrash /></button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            {canEdit && (
              <div className="modal-foot">
                <button className="btn btn-secondary" type="button" onClick={() => { const d = dayPanel; setDayPanel(null); setModal({ open: true, task: null, date: d ?? undefined }); }}>
                  <IconPlus />Add task on this day
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {modal.open && (
        <TaskModal
          initial={modal.task}
          defaultDate={modal.date}
          onClose={() => setModal({ open: false, task: null })}
          onSubmit={submit}
        />
      )}
    </AppShell>
  );
}
