import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { IconGantt, IconChevronDown, IconChevronRight } from "../components/icons";
import { listTasks, updateTask, TRADES } from "../lib/tasks";
import type { Task, TaskInput } from "../lib/tasks";
import { todayISO, addDaysISO, dateOf, fmtShort } from "../lib/dates";
import type { ApiError } from "../lib/api";

const ZOOMS = [12, 22, 36]; // px per day

function dueDate(t: Task) {
  return t.end_date ?? t.start_date;
}
function daysBetween(a: string, b: string) {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}
function tradeCls(trade: string) {
  return `ev-${TRADES.includes(trade) ? trade.toLowerCase().replace(/\s+/g, "-") : "other"}`;
}
function saneDate(v: string) {
  const y = +v.slice(0, 4);
  return y >= 2000 && y <= 2100;
}
function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

export default function Gantt() {
  const { token, user } = useAuth();
  const canEdit = user?.role === "contractor";
  const today = todayISO();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayW, setDayW] = useState(ZOOMS[1]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Bumping this remounts the editable rows, reverting inputs to server values.
  const [rev, setRev] = useState(0);
  const revert = () => setRev((r) => r + 1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitScroll = useRef(false);
  const zoomAnchor = useRef<number | null>(null);

  useEffect(() => {
    listTasks(token)
      .then(setTasks)
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load tasks"))
      .finally(() => setLoading(false));
  }, [token]);

  const range = useMemo(() => {
    let min = today;
    let max = today;
    for (const t of tasks) {
      if (t.start_date < min) min = t.start_date;
      if (dueDate(t) > max) max = dueDate(t);
    }
    return { start: addDaysISO(min, -3), end: addDaysISO(max, 14) };
  }, [tasks, today]);

  const days = useMemo(() => {
    const out: { iso: string; dom: number; dow: number }[] = [];
    for (let iso = range.start; iso <= range.end; iso = addDaysISO(iso, 1)) {
      const d = dateOf(iso);
      out.push({ iso, dom: d.getDate(), dow: d.getDay() });
    }
    return out;
  }, [range]);

  const months = useMemo(() => {
    const out: { key: string; label: string; count: number }[] = [];
    for (const d of days) {
      const key = d.iso.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.count++;
      else out.push({ key, label: dateOf(d.iso).toLocaleDateString(undefined, { month: "short", year: "numeric" }), count: 1 });
    }
    return out;
  }, [days]);

  const groups = useMemo(() => {
    const by = new Map<string, Task[]>();
    for (const t of tasks) {
      const arr = by.get(t.area);
      if (arr) arr.push(t);
      else by.set(t.area, [t]);
    }
    return [...by.entries()]
      .map(([area, ts]) => {
        ts.sort(
          (a, b) =>
            a.start_date.localeCompare(b.start_date) ||
            dueDate(a).localeCompare(dueDate(b)) ||
            a.name.localeCompare(b.name),
        );
        return {
          area,
          tasks: ts,
          start: ts.reduce((m, t) => (t.start_date < m ? t.start_date : m), ts[0].start_date),
          end: ts.reduce((m, t) => (dueDate(t) > m ? dueDate(t) : m), dueDate(ts[0])),
          pct: Math.round(ts.reduce((s, t) => s + t.progress, 0) / ts.length),
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start) || a.area.localeCompare(b.area));
  }, [tasks]);

  const trades = useMemo(
    () =>
      [...new Set(tasks.map((t) => (TRADES.includes(t.trade) ? t.trade : "Other")))].sort(
        (a, b) => TRADES.indexOf(a) - TRADES.indexOf(b),
      ),
    [tasks],
  );

  const laneW = days.length * dayW;
  const todayOff = daysBetween(range.start, today);
  const firstSun = days.findIndex((d) => d.dow === 0);
  // Day grid, Sunday bands and the today column are painted as layered
  // gradients so each row doesn't need per-day cells.
  const laneStyle: CSSProperties = {
    width: laneW,
    backgroundImage: [
      "linear-gradient(var(--g-today) 0 0)",
      `repeating-linear-gradient(90deg, var(--g-off) 0 ${dayW}px, transparent ${dayW}px ${dayW * 7}px)`,
      "linear-gradient(90deg, var(--g-line) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: `${dayW}px 100%, ${dayW * 7}px 100%, ${dayW}px 100%`,
    backgroundPosition: `${todayOff * dayW}px 0, ${firstSun * dayW}px 0, 0 0`,
    backgroundRepeat: "no-repeat, repeat-x, repeat-x",
  };

  useEffect(() => {
    if (loading || didInitScroll.current) return;
    didInitScroll.current = true;
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (todayOff - 3) * dayW);
  }, [loading, todayOff, dayW]);

  function scrollToToday() {
    scrollRef.current?.scrollTo({ left: Math.max(0, (todayOff - 3) * dayW), behavior: "smooth" });
  }

  function zoom(dir: 1 | -1) {
    const i = ZOOMS.indexOf(dayW) + dir;
    if (i < 0 || i >= ZOOMS.length) return;
    const el = scrollRef.current;
    if (el) zoomAnchor.current = (el.scrollLeft + el.clientWidth / 2) / dayW;
    setDayW(ZOOMS[i]);
  }
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && zoomAnchor.current != null) {
      el.scrollLeft = zoomAnchor.current * dayW - el.clientWidth / 2;
      zoomAnchor.current = null;
    }
  }, [dayW]);

  function toggleGroup(area: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  }

  async function patch(t: Task, body: Partial<TaskInput>) {
    try {
      const u = await updateTask(token, t.id, body);
      setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not save change");
      revert();
    }
  }

  function commitName(t: Task, v: string) {
    const name = v.trim();
    if (!name) return revert();
    if (name === t.name) return;
    patch(t, { name });
  }
  function commitStart(t: Task, v: string, final = false) {
    if (!v || !saneDate(v)) {
      if (final) revert();
      return;
    }
    if (v === t.start_date) return;
    if (t.end_date && v > t.end_date) {
      setError("Start date can't be after the end date.");
      return revert();
    }
    setError(null);
    patch(t, { start_date: v });
  }
  function commitEnd(t: Task, v: string, final = false) {
    if (!v) {
      // A cleared field only means "no end date" once the user leaves it.
      if (final && t.end_date) patch(t, { end_date: null });
      return;
    }
    if (!saneDate(v) || v === t.end_date) return;
    if (v < t.start_date) {
      setError("End date can't be before the start date.");
      return revert();
    }
    setError(null);
    patch(t, { end_date: v });
  }

  return (
    <AppShell title="Gantt" titleIcon={<IconGantt />} wide>
      {error && <div className="error-banner">{error}</div>}

      <div className="gantt-bar">
        <div className="cal-legend" style={{ margin: 0 }}>
          {trades.map((tr) => (
            <span key={tr} className={`legend-item ${tradeCls(tr)}`}><i />{tr}</span>
          ))}
        </div>
        <div className="spacer" />
        {canEdit && <span className="hint">Click a name or date to edit</span>}
        <button className="btn btn-secondary" type="button" onClick={scrollToToday}>Today</button>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom(-1)} disabled={dayW === ZOOMS[0]} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => zoom(1)} disabled={dayW === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="data-card">
        {loading ? (
          <div className="empty">Loading schedule…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">
            <h3>No tasks yet</h3>
            <p className="hint">The timeline will appear once tasks are added.</p>
          </div>
        ) : (
          <div className="g-scroll" ref={scrollRef}>
            <div className="g-canvas">
              <div className="g-row g-head">
                <div className="g-left g-head-left">
                  <span />
                  <span>Task</span>
                  <span>Start</span>
                  <span>End</span>
                  <span className="g-num">Days</span>
                </div>
                <div className="g-head-lane" style={{ width: laneW }}>
                  <div className="g-months">
                    {months.map((m) => (
                      <span key={m.key} style={{ width: m.count * dayW }}><b>{m.label}</b></span>
                    ))}
                  </div>
                  <div className="g-days">
                    {days.map((d) => (
                      <span
                        key={d.iso}
                        title={d.iso}
                        className={`${d.dow === 0 ? "off" : ""} ${d.iso === today ? "now" : ""}`}
                        style={{ width: dayW }}
                      >
                        {dayW >= 18 || d.dow === 1 ? d.dom : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {groups.map((g) => {
                const isClosed = closed.has(g.area);
                return (
                  <div key={g.area}>
                    <div className="g-row g-group">
                      <button
                        type="button"
                        className="g-left g-group-left"
                        onClick={() => toggleGroup(g.area)}
                        aria-expanded={!isClosed}
                      >
                        {isClosed ? <IconChevronRight /> : <IconChevronDown />}
                        <b>{g.area}</b>
                        <span className="panel-count">{g.tasks.length}</span>
                        <em className="mono">{g.pct}%</em>
                      </button>
                      <div className="g-lane" style={laneStyle}>
                        <span
                          className="g-sum"
                          style={{
                            left: daysBetween(range.start, g.start) * dayW + 1,
                            width: (daysBetween(g.start, g.end) + 1) * dayW - 2,
                          }}
                        />
                      </div>
                    </div>

                    {!isClosed &&
                      g.tasks.map((t) => {
                        const off = daysBetween(range.start, t.start_date);
                        const len = Math.max(1, daysBetween(t.start_date, dueDate(t)) + 1);
                        const late = t.status !== "done" && dueDate(t) < today;
                        return (
                          <div key={`${t.id}:${rev}`} className="g-row">
                            <div className="g-left">
                              <span className={`g-swatch ${tradeCls(t.trade)}`} title={t.trade || "Other"} />
                              {canEdit ? (
                                <input
                                  className="g-cell g-name"
                                  defaultValue={t.name}
                                  onBlur={(e) => commitName(t, e.target.value)}
                                  onKeyDown={blurOnEnter}
                                  aria-label="Task name"
                                />
                              ) : (
                                <span className="g-cell g-name">{t.name}</span>
                              )}
                              {canEdit ? (
                                <input
                                  type="date"
                                  className="g-cell g-date"
                                  defaultValue={t.start_date}
                                  onChange={(e) => commitStart(t, e.target.value)}
                                  onBlur={(e) => commitStart(t, e.target.value, true)}
                                  onKeyDown={blurOnEnter}
                                  aria-label="Start date"
                                />
                              ) : (
                                <span className="g-cell g-date">{fmtShort(t.start_date)}</span>
                              )}
                              {canEdit ? (
                                <input
                                  type="date"
                                  className={`g-cell g-date ${t.end_date ? "" : "g-noend"}`}
                                  title={t.end_date ? undefined : "No end date — click to set one"}
                                  defaultValue={t.end_date ?? ""}
                                  onChange={(e) => commitEnd(t, e.target.value)}
                                  onBlur={(e) => commitEnd(t, e.target.value, true)}
                                  onKeyDown={blurOnEnter}
                                  aria-label="End date"
                                />
                              ) : (
                                <span className="g-cell g-date">{t.end_date ? fmtShort(t.end_date) : "—"}</span>
                              )}
                              <span className="g-cell g-num">{len}d</span>
                            </div>
                            <div className="g-lane" style={laneStyle}>
                              <span
                                className={`g-bar ${tradeCls(t.trade)} ${t.status === "done" ? "done" : ""} ${late ? "late" : ""}`}
                                style={{ left: off * dayW + 1, width: len * dayW - 2 }}
                                title={`${t.name} · ${t.trade || "—"} · ${t.progress}%`}
                              >
                                <i style={{ width: `${t.progress}%` }} />
                              </span>
                              {t.status !== "done" && t.progress > 0 && (
                                <span className="g-bar-tag" style={{ left: (off + len) * dayW + 6 }}>
                                  {t.progress}%
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
