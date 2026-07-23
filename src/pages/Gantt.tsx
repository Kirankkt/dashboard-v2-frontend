import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import {
  IconGantt,
  IconChevronDown,
  IconChevronRight,
  IconSearch,
  IconFilter,
  IconClose,
} from "../components/icons";
import { listTasks, updateTask, TRADES } from "../lib/tasks";
import type { Task, TaskInput } from "../lib/tasks";
import { todayISO, addDaysISO, dateOf, fmtShort } from "../lib/dates";
import type { ApiError } from "../lib/api";

const ZOOMS = [8, 14, 22, 34]; // px per day
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const STATUSES = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
] as const;
type StatusKey = (typeof STATUSES)[number]["key"];

function dueDate(t: Task) {
  return t.end_date ?? t.start_date;
}
function daysBetween(a: string, b: string) {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}
function tradeOf(t: Task) {
  return TRADES.includes(t.trade) ? t.trade : "Other";
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

/** Rough relevance score so a couple of letters already surface the right row.
 *  Exact > prefix > word start > substring > letters in order. -1 = no match. */
function score(text: string, q: string) {
  const h = text.toLowerCase();
  if (h === q) return 1000;
  if (h.startsWith(q)) return 900 - h.length;
  const w = h.indexOf(` ${q}`);
  if (w >= 0) return 800 - w;
  const i = h.indexOf(q);
  if (i >= 0) return 700 - i;
  let at = -1;
  for (const ch of q) {
    at = h.indexOf(ch, at + 1);
    if (at < 0) return -1;
  }
  return 400 - h.length;
}
/** Every word typed has to match somewhere, in any order. */
function scoreAll(text: string, words: string[]) {
  let sum = 0;
  for (const w of words) {
    const s = score(text, w);
    if (s < 0) return -1;
    sum += s;
  }
  return sum / words.length;
}

type Hint =
  | { kind: "area"; label: string; sub: string }
  | { kind: "trade"; label: string; sub: string }
  | { kind: "task"; label: string; sub: string; task: Task };

export default function Gantt() {
  const { token, user } = useAuth();
  // Both roles reschedule from here; the API limits the client to these fields.
  const canEdit = !!user;
  const today = todayISO();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayW, setDayW] = useState(ZOOMS[2]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Bumping this remounts the editable rows, reverting inputs to server values.
  const [rev, setRev] = useState(0);
  const revert = () => setRev((r) => r + 1);

  // search
  const [query, setQuery] = useState("");
  const [openHints, setOpenHints] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [jump, setJump] = useState<{ area: string; id?: number } | null>(null);
  const [hit, setHit] = useState<number | null>(null);

  // filters
  const [fOpen, setFOpen] = useState(false);
  const [fTrades, setFTrades] = useState<Set<string>>(new Set());
  const [fStatus, setFStatus] = useState<Set<StatusKey>>(new Set());
  const [fAreas, setFAreas] = useState<Set<string>>(new Set());
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fLate, setFLate] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const didInitScroll = useRef(false);
  const zoomAnchor = useRef<number | null>(null);

  useEffect(() => {
    listTasks(token)
      .then(setTasks)
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load tasks"))
      .finally(() => setLoading(false));
  }, [token]);

  // "/" anywhere focuses the search box.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allAreas = useMemo(
    () => [...new Set(tasks.map((t) => t.area))].sort((a, b) => a.localeCompare(b)),
    [tasks],
  );
  const allTrades = useMemo(
    () => [...new Set(tasks.map(tradeOf))].sort((a, b) => TRADES.indexOf(a) - TRADES.indexOf(b)),
    [tasks],
  );

  const nFilters =
    fTrades.size + fStatus.size + fAreas.size + (fFrom ? 1 : 0) + (fTo ? 1 : 0) + (fLate ? 1 : 0);

  const shown = useMemo(
    () =>
      tasks.filter((t) => {
        if (fTrades.size && !fTrades.has(tradeOf(t))) return false;
        if (fStatus.size && !fStatus.has(t.status)) return false;
        if (fAreas.size && !fAreas.has(t.area)) return false;
        if (fLate && !(t.status !== "done" && dueDate(t) < today)) return false;
        if (fFrom && dueDate(t) < fFrom) return false; // keep anything overlapping the window
        if (fTo && t.start_date > fTo) return false;
        return true;
      }),
    [tasks, fTrades, fStatus, fAreas, fLate, fFrom, fTo, today],
  );

  function clearFilters() {
    setFTrades(new Set());
    setFStatus(new Set());
    setFAreas(new Set());
    setFFrom("");
    setFTo("");
    setFLate(false);
  }
  function toggleIn<T>(set: Set<T>, v: T) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  const hints = useMemo<Hint[]>(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: { s: number; h: Hint }[] = [];
    for (const a of allAreas) {
      const s = scoreAll(a, words);
      const n = shown.filter((t) => t.area === a).length;
      if (s > 0 && n) scored.push({ s: s + 120, h: { kind: "area", label: a, sub: `${n} tasks` } });
    }
    for (const tr of allTrades) {
      const s = scoreAll(tr, words);
      const n = shown.filter((t) => tradeOf(t) === tr).length;
      if (s > 0 && n)
        scored.push({ s: s + 90, h: { kind: "trade", label: tr, sub: `${n} tasks · filter` } });
    }
    for (const t of shown) {
      // The name is what the user is usually after; area and trade still match.
      const s = Math.max(
        scoreAll(t.name, words),
        scoreAll(`${t.name} ${t.area} ${t.trade}`, words) - 60,
      );
      if (s > 0)
        scored.push({
          s,
          h: { kind: "task", label: t.name, sub: `${t.area} · ${fmtShort(t.start_date)}`, task: t },
        });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.h);
  }, [query, shown, allAreas, allTrades]);

  const range = useMemo(() => {
    const src = shown.length ? shown : tasks;
    let min = today;
    let max = today;
    if (src.length) {
      min = src[0].start_date;
      max = dueDate(src[0]);
      for (const t of src) {
        if (t.start_date < min) min = t.start_date;
        if (dueDate(t) > max) max = dueDate(t);
      }
      if (today < min) min = today;
      if (today > max) max = today;
    }
    return { start: addDaysISO(min, -3), end: addDaysISO(max, 10) };
  }, [shown, tasks, today]);

  const days = useMemo(() => {
    const out: { iso: string; dom: number; dow: number }[] = [];
    for (let iso = range.start; iso <= range.end; iso = addDaysISO(iso, 1)) {
      const d = dateOf(iso);
      out.push({ iso, dom: d.getDate(), dow: d.getDay() });
    }
    return out;
  }, [range]);

  const months = useMemo(() => {
    const out: { key: string; label: string; short: string; from: number; count: number }[] = [];
    days.forEach((d, i) => {
      const key = d.iso.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.count++;
      else {
        const dt = dateOf(d.iso);
        out.push({
          key,
          label: dt.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
          short: dt.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
          from: i,
          count: 1,
        });
      }
    });
    return out;
  }, [days]);

  const groups = useMemo(() => {
    const by = new Map<string, Task[]>();
    for (const t of shown) {
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
  }, [shown]);

  const legend = useMemo(
    () => [...new Set(shown.map(tradeOf))].sort((a, b) => TRADES.indexOf(a) - TRADES.indexOf(b)),
    [shown],
  );

  const laneW = days.length * dayW;
  const todayOff = daysBetween(range.start, today);
  const firstSun = days.findIndex((d) => d.dow === 0);
  const inRange = today >= range.start && today <= range.end;
  // Day grid and weekend bands are painted once, as gradients, behind every row.
  const gridStyle: CSSProperties = {
    left: "var(--g-left-w)",
    width: laneW,
    backgroundImage: [
      `repeating-linear-gradient(90deg, var(--g-off) 0 ${dayW}px, transparent ${dayW}px ${dayW * 7}px)`,
      `linear-gradient(90deg, var(--g-line) 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: `${dayW * 7}px 100%, ${dayW}px 100%`,
    backgroundPosition: `${firstSun * dayW}px 0, 0 0`,
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
    setClosed((prev) => toggleIn(prev, area));
  }

  // Search picks set `jump`; the row only exists after its group is open, so the
  // actual scrolling happens here on the next render.
  useEffect(() => {
    if (!jump) return;
    const el = scrollRef.current;
    const row = el?.querySelector<HTMLElement>(
      jump.id ? `[data-row="t${jump.id}"]` : `[data-row="g${CSS.escape(jump.area)}"]`,
    );
    if (el && row) {
      const target = shown.find((t) => t.id === jump.id);
      el.scrollTo({
        top: Math.max(0, row.offsetTop - 96),
        left: target ? Math.max(0, (daysBetween(range.start, target.start_date) - 3) * dayW) : el.scrollLeft,
        behavior: "smooth",
      });
    }
    setJump(null);
  }, [jump, shown, range.start, dayW]);

  function pick(h: Hint) {
    setOpenHints(false);
    if (h.kind === "trade") {
      setFTrades(new Set([h.label]));
      setQuery("");
      return;
    }
    const area = h.kind === "area" ? h.label : h.task.area;
    setClosed((prev) => {
      const next = new Set(prev);
      next.delete(area);
      return next;
    });
    if (h.kind === "task") {
      setHit(h.task.id);
      window.setTimeout(() => setHit(null), 2200);
    }
    setJump({ area, id: h.kind === "task" ? h.task.id : undefined });
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpenHints(false);
      e.currentTarget.blur();
      return;
    }
    if (!hints.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hints.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hints.length) % hints.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hints[Math.min(cursor, hints.length - 1)]);
    }
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

  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.area));

  return (
    <AppShell title="Gantt" titleIcon={<IconGantt />} wide>
      {error && <div className="error-banner">{error}</div>}

      <div className="gantt-bar">
        <div className="search-wrap g-search">
          <IconSearch />
          <input
            ref={searchRef}
            className="input"
            placeholder="Search tasks, areas, trades…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenHints(true);
              setCursor(0);
            }}
            onFocus={() => setOpenHints(true)}
            onBlur={() => window.setTimeout(() => setOpenHints(false), 120)}
            onKeyDown={onSearchKey}
            aria-label="Search the schedule"
          />
          {query && (
            <button type="button" className="g-search-x" onClick={() => setQuery("")} aria-label="Clear search">
              <IconClose />
            </button>
          )}
          {openHints && hints.length > 0 && (
            <ul className="g-hints" role="listbox">
              {hints.map((h, i) => (
                <li key={`${h.kind}:${h.label}:${i}`}>
                  <button
                    type="button"
                    className={i === cursor ? "on" : ""}
                    onMouseEnter={() => setCursor(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                  >
                    <em>{h.kind}</em>
                    <b>{h.label}</b>
                    <span>{h.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
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
                        onClick={() => setFTrades((s) => toggleIn(s, tr))}
                      >
                        <i />
                        {tr}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="g-pop-sec">
                  <label>Status</label>
                  <div className="g-pop-tags">
                    {STATUSES.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className="g-tag"
                        aria-pressed={fStatus.has(s.key)}
                        onClick={() => setFStatus((v) => toggleIn(v, s.key))}
                      >
                        {s.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="g-tag g-tag-late"
                      aria-pressed={fLate}
                      onClick={() => setFLate((v) => !v)}
                    >
                      Overdue
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
                        <input
                          type="checkbox"
                          checked={fAreas.has(a)}
                          onChange={() => setFAreas((s) => toggleIn(s, a))}
                        />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map((g) => g.area)))}
          disabled={!groups.length}
        >
          {allClosed ? "Expand all" : "Collapse all"}
        </button>

        <div className="spacer" />

        <div className="cal-legend g-legend">
          {legend.map((tr) => (
            <span key={tr} className={`legend-item ${tradeCls(tr)}`}>
              <i />
              {tr}
            </span>
          ))}
        </div>

        <button className="btn btn-secondary" type="button" onClick={scrollToToday}>
          Today
        </button>
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom(-1)} disabled={dayW === ZOOMS[0]} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            onClick={() => zoom(1)}
            disabled={dayW === ZOOMS[ZOOMS.length - 1]}
            aria-label="Zoom in"
          >
            +
          </button>
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
        ) : shown.length === 0 ? (
          <div className="empty">
            <h3>Nothing matches these filters</h3>
            <p className="hint">
              <button type="button" className="g-link" onClick={clearFilters}>
                Clear all filters
              </button>
            </p>
          </div>
        ) : (
          <div className="g-scroll" ref={scrollRef}>
            <div className="g-canvas">
              {/* One painted layer for the whole chart: day grid, weekends,
                  alternating months and the today marker. */}
              <div className="g-grid" style={gridStyle}>
                {months.map((m, i) => (
                  <span
                    key={m.key}
                    className={`g-mband ${i % 2 ? "alt" : ""}`}
                    style={{ left: m.from * dayW, width: m.count * dayW }}
                  />
                ))}
                {inRange && (
                  <span className="g-nowline" style={{ left: todayOff * dayW, width: dayW }} />
                )}
              </div>

              <div className="g-row g-head">
                <div className="g-left g-head-left">
                  <span />
                  <span>Task</span>
                  <span>Start</span>
                  <span>Finish</span>
                  <span className="g-num">Days</span>
                  <span className="g-num">%</span>
                </div>
                <div className="g-head-lane" style={{ width: laneW }}>
                  <div className="g-months">
                    {months.map((m) => (
                      <span key={m.key} style={{ width: m.count * dayW }}>
                        {m.count * dayW >= 34 && <b>{m.count * dayW < 104 ? m.short : m.label}</b>}
                      </span>
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
                        {dayW >= 14 || d.dow === 1 ? d.dom : ""}
                        {dayW >= 22 && <em>{DOW[d.dow]}</em>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {groups.map((g) => {
                const isClosed = closed.has(g.area);
                return (
                  <div key={g.area}>
                    <div className="g-row g-group" data-row={`g${g.area}`}>
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
                      <div className="g-lane" style={{ width: laneW }}>
                        <span
                          className="g-sum"
                          style={{
                            left: daysBetween(range.start, g.start) * dayW + 1,
                            width: (daysBetween(g.start, g.end) + 1) * dayW - 2,
                          }}
                        >
                          <i style={{ width: `${g.pct}%` }} />
                        </span>
                      </div>
                    </div>

                    {!isClosed &&
                      g.tasks.map((t) => {
                        const off = daysBetween(range.start, t.start_date);
                        const len = Math.max(1, daysBetween(t.start_date, dueDate(t)) + 1);
                        const late = t.status !== "done" && dueDate(t) < today;
                        const w = len * dayW - 2;
                        return (
                          <div
                            key={`${t.id}:${rev}`}
                            data-row={`t${t.id}`}
                            className={`g-row ${hit === t.id ? "hit" : ""}`}
                          >
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
                                <span className="g-cell g-name" title={t.name}>
                                  {t.name}
                                </span>
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
                                  title={t.end_date ? undefined : "No finish date — click to set one"}
                                  defaultValue={t.end_date ?? ""}
                                  onChange={(e) => commitEnd(t, e.target.value)}
                                  onBlur={(e) => commitEnd(t, e.target.value, true)}
                                  onKeyDown={blurOnEnter}
                                  aria-label="Finish date"
                                />
                              ) : (
                                <span className="g-cell g-date">
                                  {t.end_date ? fmtShort(t.end_date) : "—"}
                                </span>
                              )}
                              <span className="g-cell g-num">{len}d</span>
                              <span className={`g-cell g-num g-pct ${late ? "is-late" : ""}`}>
                                {t.progress}
                              </span>
                            </div>
                            <div className="g-lane" style={{ width: laneW }}>
                              <span
                                className={`g-bar ${tradeCls(t.trade)} ${t.status === "done" ? "done" : ""} ${
                                  late ? "late" : ""
                                }`}
                                style={{ left: off * dayW + 1, width: w }}
                                title={`${t.name} · ${t.trade || "—"} · ${fmtShort(t.start_date)} → ${
                                  t.end_date ? fmtShort(t.end_date) : "—"
                                } · ${t.progress}%`}
                              >
                                <i style={{ width: `${t.progress}%` }} />
                                {w >= 46 && <b>{t.progress}%</b>}
                              </span>
                              {w < 46 && t.progress > 0 && (
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
