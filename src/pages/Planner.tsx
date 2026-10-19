import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as RKeyboardEvent,
  MouseEvent as RMouseEvent,
  PointerEvent as RPointerEvent,
} from "react";
import { AppShell } from "../components/AppShell";
import { TaskModal } from "../components/TaskModal";
import { TaskEditor, QuickAdd, tradeCls } from "../components/PlannerEditor";
import type { QuickTask } from "../components/PlannerEditor";
import GridBody from "../components/PlannerGrid";
import type { Day, Entry, GridRow } from "../components/PlannerGrid";
import { useAuth, canEdit } from "../auth/AuthContext";
import {
  IconGrid,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconClose,
  IconPlus,
  IconFilter,
  IconCheck,
  IconRollover,
  IconTrash,
} from "../components/icons";
import { listTasks, createTask, updateTask, deleteTask, getOffDays, TRADES } from "../lib/tasks";
import type { Task, TaskInput, TaskStatus } from "../lib/tasks";
import { todayISO, addDaysISO, dateOf } from "../lib/dates";
import { useIsPhone } from "../lib/useIsPhone";
import { saveError } from "../lib/api";
import type { ApiError } from "../lib/api";
import { SaveAlert } from "../components/SaveAlert";
import type { SaveFailure } from "../components/SaveAlert";

const PHONE = "(max-width: 700px)";
const WEEKS = [1, 2, 4] as const;
type Weeks = (typeof WEEKS)[number];
type Period = { kind: "weeks"; weeks: Weeks } | { kind: "custom"; days: number };
const MAX_CUSTOM_DAYS = 180;
// Zoom = minimum day-column width. Narrow columns show less on each card.
const ZOOM_MIN = 52;
const ZOOM_MAX = 260;
const ZOOM_STEP = 1.2;
const THIN_W = 30; // an empty off-day column
type Tier = "s" | "m" | "l" | "xl";
const tierOf = (w: number): Tier => (w < 72 ? "s" : w < 104 ? "m" : w < 140 ? "l" : "xl");
const CARD_LIMIT: Record<Tier, number> = { s: 3, m: 3, l: 4, xl: 6 };
const PREFS_KEY = "planner_prefs";
const AREAS_KEY = "planner_areas";
const TRADE_KEY = "planner_trade";
const UNDO_LIMIT = 30;
const EDGE = 28; // px: drag-time paging strips at the grid's sides
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

// Row order from the old planner (walking through the house); anything else
// follows alphabetically.
const HOUSE_ORDER = [
  "Car Park", "Sit out", "Living/Dining Room", "Hallway", "Stairs",
  "Bedroom 1", "Toilet 1", "Bedroom 2", "Toilet 2", "Veranda",
  "Maid's Room", "Maid's Toilet", "Kitchen", "Pantry / Work Area", "Back Slab",
  "Outside Bathroom", "Library", "Conference Area", "New Bedroom 3", "Toilet 3",
  "Office", "Terrace Patio", "Outside wall", "Parapet wall", "Sunshade",
  "Yard", "Coumpound wall", "Septic tank construction", "Second floor terrace / Roof",
  "Waste Removal", "Termite Treatment", "Building Exterior", "Landscaping",
].map((a) => a.toLowerCase());

type Cell = { area: string; iso: string };
type Target = Cell & { tone: "ok" | "no" | "idle"; tip: string };
const NO_ENTRIES: Entry[] = [];
const NO_IDS: Set<number> = new Set();
const DROP_CLASSES = ["drop-ok", "drop-no", "drop-idle"];
type Undo = { label: string; run: () => Promise<void> };
type Drag = {
  ids: number[];
  lead: Task;
  grabIso: string;
  fromArea: string;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  copy: boolean;
  target: Target | null;
};
type Press = {
  x: number;
  y: number;
  task: Task;
  iso: string;
  el: HTMLElement;
  touch: boolean;
  timer: number | null;
  detach: () => void;
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function mondayOf(iso: string) {
  return addDaysISO(iso, -((dateOf(iso).getDay() + 6) % 7));
}
function daysBetween(a: string, b: string) {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}
function dueOf(t: Task) {
  return t.end_date && t.end_date > t.start_date ? t.end_date : t.start_date;
}
function tradeOf(t: Task) {
  return TRADES.includes(t.trade) ? t.trade : "Other";
}
function areaRank(a: string) {
  const i = HOUSE_ORDER.indexOf(a.toLowerCase());
  return i < 0 ? HOUSE_ORDER.length : i;
}
function fmtRange(from: string, to: string) {
  const a = dateOf(from);
  const b = dateOf(to);
  const tail = b.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${tail}`;
  return `${a.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${tail}`;
}
function shortDay(iso: string) {
  return dateOf(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
/** Mirrors the API: progress decides status; a bare status is a shortcut. */
function applyLocal(t: Task, body: Partial<TaskInput>): Task {
  const next = { ...t, ...body } as Task;
  if ("status" in body && !("progress" in body)) {
    if (body.status === "done") next.progress = 100;
    else if (body.status === "todo") next.progress = 0;
    else if (t.progress <= 0 || t.progress >= 100) next.progress = 10;
  }
  next.progress = Math.max(0, Math.min(100, next.progress));
  next.status = next.progress >= 100 ? "done" : next.progress > 0 ? "in_progress" : "todo";
  return next;
}
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

export default function Planner() {
  const { token, user } = useAuth();
  const fullEdit = canEdit(user); // full editing rights (contractor, or client with full access)
  const isPhone = useIsPhone();
  const today = todayISO();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prefs] = useState(() =>
    readJSON(PREFS_KEY, {
      period: { kind: "weeks", weeks: 2 } as Period,
      zoom: 116,
      hideDone: false,
      activeOnly: false,
    }),
  );
  const [period, setPeriod] = useState<Period>(() => {
    const p = prefs.period as { kind?: string; days?: number; weeks?: Weeks } | undefined;
    const stored: Period =
      p?.kind === "custom" && p.days && p.days >= 1 && p.days <= MAX_CUSTOM_DAYS
        ? { kind: "custom", days: Math.round(p.days) }
        : { kind: "weeks", weeks: p?.weeks && WEEKS.includes(p.weeks) ? p.weeks : 2 };
    return window.matchMedia(PHONE).matches ? { kind: "weeks", weeks: 1 } : stored;
  });
  const len = period.kind === "weeks" ? period.weeks * 7 : period.days;
  const [colW, setColW] = useState(() => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(prefs.zoom) || 116)));
  const [zoomUi, setZoomUi] = useState({ tier: tierOf(colW), canIn: true, canOut: true });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState({ from: "", to: "", err: "" });
  const [hideDone, setHideDone] = useState(prefs.hideDone);
  const [activeOnly, setActiveOnly] = useState(prefs.activeOnly);
  const [from, setFrom] = useState(() => (period.kind === "weeks" ? mondayOf(todayISO()) : todayISO()));
  const [offMap, setOffMap] = useState<{ key: string; days: Set<string> } | null>(null);

  const [query, setQuery] = useState("");
  const [queryLive, setQueryLive] = useState("");
  const [fTrades, setFTrades] = useState<Set<string>>(new Set());
  const [fOpen, setFOpen] = useState(false);
  const [extraAreas, setExtraAreas] = useState<string[]>(() => readJSON(AREAS_KEY, { list: [] as string[] }).list);
  const [newArea, setNewArea] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<Set<number>>(new Set());

  const [editor, setEditor] = useState<{ id: number; rect: DOMRect } | null>(null);
  const [composer, setComposer] = useState<(Cell & { rect: DOMRect }) | null>(null);
  const [modal, setModal] = useState(false);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [edge, setEdge] = useState<-1 | 0 | 1>(0);
  const [undoCount, setUndoCount] = useState(0);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: boolean; n: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<Press | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const targetKey = useRef("");
  const suppressClickUntil = useRef(0);
  const undoRef = useRef<Undo[]>([]);
  const panStopRef = useRef<(() => void) | null>(null);
  const didScroll = useRef(false);

  // ---------- data ----------
  const load = useCallback(() => listTasks(token).then(setTasks), [token]);
  useEffect(() => {
    load()
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load tasks"))
      .finally(() => setLoading(false));
  }, [load]);
  // Pick up the other person's edits when coming back to the tab.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible" && !dragRef.current) load().catch(() => {});
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ period, zoom: colW, hideDone, activeOnly }));
    } catch {
      /* private mode — prefs just won't stick */
    }
  }, [period, colW, hideDone, activeOnly]);
  useEffect(() => {
    try {
      localStorage.setItem(AREAS_KEY, JSON.stringify({ list: extraAreas }));
    } catch {
      /* ignore */
    }
  }, [extraAreas]);

  const days = useMemo<Day[]>(
    () =>
      Array.from({ length: len }, (_, i) => {
        const iso = addDaysISO(from, i);
        const d = dateOf(iso);
        return {
          iso,
          dom: d.getDate(),
          dow: d.getDay(),
          weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
          month: i === 0 || d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: "short" }) : "",
        };
      }),
    [from, len],
  );
  const to = days[days.length - 1].iso;
  const rangeKey = `${from}:${to}`;

  useEffect(() => {
    let active = true;
    getOffDays(token, from, to)
      .then((list) => active && setOffMap({ key: `${from}:${to}`, days: new Set(list) }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token, from, to]);
  // Sundays until the server's list arrives (or if it can't be fetched).
  const offSet = useMemo(
    () => (offMap?.key === rangeKey ? offMap.days : new Set(days.filter((d) => d.dow === 0).map((d) => d.iso))),
    [offMap, rangeKey, days],
  );

  // ---------- derived grid ----------
  // The grid rebuilds on `query`; the input shows `queryLive` so typing stays
  // responsive on a phone.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(queryLive.trim().toLowerCase()), 160);
    return () => window.clearTimeout(id);
  }, [queryLive]);
  const q = query;
  const byCell = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const t of tasks) {
      if (hideDone && t.status === "done") continue;
      if (fTrades.size && !fTrades.has(tradeOf(t))) continue;
      const end = dueOf(t);
      if (end < from || t.start_date > to) continue;
      const first = t.start_date < from ? from : t.start_date;
      const last = end > to ? to : end;
      for (let iso = first; iso <= last; iso = addDaysISO(iso, 1)) {
        const cont = iso !== t.start_date;
        if (cont && offSet.has(iso)) continue; // nobody works a multi-day task on an off-day
        const key = `${t.area}|${iso}`;
        const entry = { task: t, cont };
        const arr = map.get(key);
        if (arr) arr.push(entry);
        else map.set(key, [entry]);
      }
    }
    const rank = (e: Entry) =>
      (e.cont ? 4 : 0) + (e.task.status === "done" ? 2 : 0) + (e.task.priority === "high" ? 0 : 1);
    for (const arr of map.values()) arr.sort((a, b) => rank(a) - rank(b) || a.task.id - b.task.id);
    return map;
  }, [tasks, from, to, hideDone, fTrades, offSet]);

  const matches = useCallback(
    (t: Task) => !q || `${t.name} ${t.area} ${t.trade}`.toLowerCase().includes(q),
    [q],
  );

  const allAreas = useMemo(() => {
    const set = new Set(tasks.map((t) => t.area));
    for (const a of extraAreas) set.add(a);
    return [...set].sort((a, b) => areaRank(a) - areaRank(b) || a.localeCompare(b));
  }, [tasks, extraAreas]);

  const rows = useMemo<GridRow[]>(() => {
    const stats = new Map<string, { total: number; sum: number }>();
    for (const t of tasks) {
      const s = stats.get(t.area) ?? { total: 0, sum: 0 };
      s.total++;
      s.sum += t.progress;
      stats.set(t.area, s);
    }
    const out: GridRow[] = [];
    for (const area of allAreas) {
      const cells: Entry[][] = [];
      let inView = 0;
      let hits = 0;
      for (const d of days) {
        const es = byCell.get(`${area}|${d.iso}`) ?? NO_ENTRIES;
        cells.push(es);
        inView += es.length;
        for (const e of es) if (matches(e.task)) hits++;
      }
      const s = stats.get(area);
      const extra = !s;
      if (q ? hits === 0 : activeOnly && inView === 0 && !extra) continue;
      out.push({
        area,
        total: s?.total ?? 0,
        pct: s ? Math.round(s.sum / s.total) : 0,
        extra,
        cells,
      });
    }
    return out;
  }, [allAreas, tasks, days, byCell, matches, q, activeOnly]);

  // Off-days with nothing on them shrink to a thin hatched column.
  const collapsed = useMemo(() => {
    const out = new Set<string>();
    days.forEach((d, i) => {
      if (offSet.has(d.iso) && !rows.some((r) => r.cells[i].length)) out.add(d.iso);
    });
    return out;
  }, [days, offSet, rows]);

  // Columns are at least the zoom width; spare room is shared evenly. The grid
  // gets an explicit width so long task names can't stretch their column. Both
  // read --pl-col-w, so zooming is a CSS variable change, not a re-render.
  const cols = `var(--pl-area-w) ${days
    .map((d) => (collapsed.has(d.iso) ? `${THIN_W}px` : "minmax(var(--pl-col-w), 1fr)"))
    .join(" ")}`;
  const lanesW = `calc(var(--pl-col-w) * ${days.length - collapsed.size} + ${collapsed.size * THIN_W}px)`;

  const periodStats = useMemo(() => {
    const seen = new Set<number>(); // byCell only holds this period's days
    for (const arr of byCell.values()) for (const e of arr) seen.add(e.task.id);
    let late = 0;
    let done = 0;
    for (const t of tasks) {
      if (!seen.has(t.id)) continue;
      if (t.status === "done") done++;
      else if (dueOf(t) < today) late++;
    }
    return { total: seen.size, late, done };
  }, [byCell, tasks, today]);

  const legend = useMemo(() => {
    const set = new Set<string>();
    for (const arr of byCell.values()) for (const e of arr) set.add(tradeOf(e.task));
    return [...set].sort((a, b) => TRADES.indexOf(a) - TRADES.indexOf(b));
  }, [byCell]);
  const presentTrades = useMemo(
    () => [...new Set(tasks.map(tradeOf))].sort((a, b) => TRADES.indexOf(a) - TRADES.indexOf(b)),
    [tasks],
  );

  // ---------- helpers ----------
  const taskById = (id: string | undefined) => tasks.find((t) => String(t.id) === id);
  const replaceTask = useCallback((u: Task) => setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x))), []);

  function flashIds(ids: number[]) {
    setFlash(new Set(ids));
    window.setTimeout(() => setFlash(new Set()), 1600);
  }
  function notify(text: string, undo = true) {
    setToast((t) => ({ text, undo, n: (t?.n ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  function pushUndo(entry: Undo) {
    undoRef.current = [...undoRef.current, entry].slice(-UNDO_LIMIT);
    setUndoCount(undoRef.current.length);
  }
  async function undoLast() {
    const entry = undoRef.current.pop();
    setUndoCount(undoRef.current.length);
    if (!entry) return;
    notify(`Undone: ${entry.label}`, false);
    try {
      await entry.run();
    } catch (e) {
      fail(e, "That undo");
    }
  }
  /** A write that didn't land. The grid is reloaded so what's on screen is
   *  what the server actually has, and the alert stays put until dismissed. */
  function fail(e: unknown, what: string, retry?: () => void) {
    setFailure({ message: saveError(e, what), retry });
    load().catch(() => {});
  }

  /** Bring today's column into view (with a day of context) if it's hidden. */
  function scrollToToday(smooth = false) {
    const sc = scrollRef.current;
    const el = sc?.querySelector<HTMLElement>(".pl-dh.today");
    const corner = sc?.querySelector<HTMLElement>(".pl-corner");
    if (!sc || !el || !corner) return;
    const viewL = sc.scrollLeft + corner.offsetWidth;
    const viewR = sc.scrollLeft + sc.clientWidth;
    if (el.offsetLeft >= viewL && el.offsetLeft + el.offsetWidth <= viewR) return;
    const left = el.offsetLeft - corner.offsetWidth - el.offsetWidth;
    sc.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "auto" });
  }
  useEffect(() => {
    if (loading || didScroll.current) return;
    didScroll.current = true;
    scrollToToday();
  }, [loading]);

  function shift(dir: number) {
    setFrom((f) => addDaysISO(f, dir * len));
  }
  function goToday() {
    const start = period.kind === "weeks" ? mondayOf(today) : today;
    if (start === from) scrollToToday(true);
    else {
      setFrom(start);
      window.setTimeout(() => scrollToToday(true), 30);
    }
  }
  function pickWeeks(w: Weeks) {
    setRangeOpen(false);
    setPeriod({ kind: "weeks", weeks: w });
    setFrom((f) => mondayOf(f));
  }
  function openCustom() {
    setJumpOpen(false);
    setRangeDraft({ from, to, err: "" });
    setRangeOpen((v) => !v);
  }
  function applyCustom() {
    const { from: a, to: b } = rangeDraft;
    if (!a || !b) return setRangeDraft((d) => ({ ...d, err: "Pick both dates." }));
    if (b < a) return setRangeDraft((d) => ({ ...d, err: "The end date is before the start." }));
    const n = daysBetween(a, b) + 1;
    if (n > MAX_CUSTOM_DAYS) return setRangeDraft((d) => ({ ...d, err: `Keep it to ${MAX_CUSTOM_DAYS} days or less.` }));
    setPeriod({ kind: "custom", days: n });
    setFrom(a);
    setRangeOpen(false);
  }

  // ---------- zoom ----------
  const zoomRef = useRef(colW);
  const zoomTimer = useRef(0);
  /** Column width that exactly fills the visible grid; zooming out stops here. */
  function fitWidth(sc: HTMLElement) {
    const corner = sc.querySelector<HTMLElement>(".pl-corner")?.offsetWidth ?? 0;
    const wide = sc.querySelectorAll(".pl-head .pl-dh:not(.thin)").length;
    const thin = sc.querySelectorAll(".pl-head .pl-dh.thin").length;
    return wide ? (sc.clientWidth - corner - thin * THIN_W) / wide : 0;
  }
  function syncZoom() {
    const sc = scrollRef.current;
    if (!sc) return;
    const fit = fitWidth(sc);
    const eff = Math.max(zoomRef.current, fit);
    const tier = tierOf(eff);
    sc.dataset.zoom = tier;
    const canIn = eff < ZOOM_MAX - 0.5;
    const canOut = eff > Math.max(ZOOM_MIN, fit) + 0.5;
    setZoomUi((u) => (u.tier === tier && u.canIn === canIn && u.canOut === canOut ? u : { tier, canIn, canOut }));
  }
  /** Scale the columns, keeping the day under `anchorX` (default: centre) still. */
  function applyZoom(factor: number, anchorX?: number) {
    const sc = scrollRef.current;
    if (!sc) return;
    const fit = fitWidth(sc);
    const base = Math.max(zoomRef.current, fit);
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit, base * factor));
    if (Math.abs(next - base) < 0.5) return;
    const box = sc.getBoundingClientRect();
    const corner = sc.querySelector<HTMLElement>(".pl-corner")?.offsetWidth ?? 0;
    const ax = anchorX ?? box.left + corner + (sc.clientWidth - corner) / 2;
    const heads = [...sc.querySelectorAll<HTMLElement>(".pl-head .pl-dh")];
    let idx = -1;
    let frac = 0;
    for (let i = 0; i < heads.length; i++) {
      const r = heads[i].getBoundingClientRect();
      if (ax >= r.left && ax < r.right) {
        idx = i;
        frac = (ax - r.left) / r.width;
        break;
      }
    }
    zoomRef.current = next;
    sc.style.setProperty("--pl-col-w", `${next}px`);
    if (idx >= 0) {
      const r = heads[idx].getBoundingClientRect();
      sc.scrollLeft += r.left + frac * r.width - ax;
    }
    syncZoom();
    window.clearTimeout(zoomTimer.current);
    zoomTimer.current = window.setTimeout(() => setColW(Math.round(zoomRef.current)), 200);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measuring is cheap
  // but not free: re-measure when the grid's width can actually have changed.
  useLayoutEffect(syncZoom, [days.length, collapsed, colW, loading]);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      live.current.applyZoom(Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.005), e.clientX);
    };
    const ro = new ResizeObserver(() => live.current.syncZoom());
    sc.addEventListener("wheel", onWheel, { passive: false });
    ro.observe(sc);
    return () => {
      sc.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [loading]);

  // Leaving the page mid-drag/pan would otherwise strand the window listeners
  // and the grabbing cursor.
  useEffect(
    () => () => {
      pressRef.current?.detach();
      panStopRef.current?.();
      window.clearTimeout(zoomTimer.current);
      document.body.classList.remove("pl-grabbing", "pl-panning");
    },
    [],
  );

  // ---------- one listener for the grid: press a card, or pan the view ----------
  function onGridDown(e: RPointerEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (!el.closest("button, input, select, a")) {
      const card = el.closest<HTMLElement>("[data-tid]");
      const cell = card?.closest<HTMLElement>("[data-cell]");
      if (card && cell) {
        const t = taskById(card.dataset.tid);
        if (t) onCardDown(e, t, cell.dataset.iso!, card);
        return;
      }
    }
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (el.closest("button, input, select, a")) return;
    const sc = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop };
    let panning = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!panning) {
        if (Math.hypot(dx, dy) < 4) return;
        panning = true;
        document.body.classList.add("pl-panning");
        window.getSelection()?.removeAllRanges();
      }
      sc.scrollLeft = start.left - dx;
      sc.scrollTop = start.top - dy;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("pl-panning");
      panStopRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    panStopRef.current = up;
  }

  // ---------- writes ----------
  async function saveTask(t: Task, body: Partial<TaskInput>, label: string) {
    const before: Partial<TaskInput> = {};
    for (const k of Object.keys(body) as (keyof TaskInput)[]) {
      (before as Record<string, unknown>)[k] = t[k];
    }
    if ("status" in body || "progress" in body) {
      delete before.status;
      before.progress = t.progress;
    }
    replaceTask(applyLocal(t, body));
    try {
      replaceTask(await updateTask(token, t.id, body));
      setFailure(null);
      pushUndo({ label, run: async () => replaceTask(await updateTask(token, t.id, before)) });
      notify(`${label}: “${t.name}”`);
    } catch (e) {
      replaceTask(t);
      fail(e, `“${t.name}”`, () => saveTask(t, body, label));
    }
  }

  function toggleDone(t: Task) {
    const status: TaskStatus = t.status === "done" ? "todo" : "done";
    saveTask(t, { status }, status === "done" ? "Marked done" : "Reopened");
  }

  async function moveTasks(group: Task[], delta: number, area: string | null) {
    const plan = group
      .map((t) => {
        const body: Partial<TaskInput> = {};
        if (area && area !== t.area) body.area = area;
        if (delta) {
          body.start_date = addDaysISO(t.start_date, delta);
          if (t.end_date) body.end_date = addDaysISO(t.end_date, delta);
        }
        return { t, body };
      })
      .filter((p) => Object.keys(p.body).length);
    if (!plan.length) return;
    setTasks((prev) => prev.map((x) => {
      const p = plan.find((y) => y.t.id === x.id);
      return p ? { ...x, ...p.body } : x;
    }));
    flashIds(plan.map((p) => p.t.id));
    try {
      const saved = await Promise.all(plan.map((p) => updateTask(token, p.t.id, p.body)));
      saved.forEach(replaceTask);
      const dest = `${area ?? ""}${area ? " · " : ""}${shortDay(saved[0].start_date)}`;
      const what = plan.length === 1 ? `“${plan[0].t.name}”` : plural(plan.length, "task");
      const label = `Moved ${what}`;
      pushUndo({
        label,
        run: async () => {
          const back = await Promise.all(
            plan.map((p) => {
              const body: Partial<TaskInput> = {};
              if (p.body.area) body.area = p.t.area;
              if (p.body.start_date) {
                body.start_date = p.t.start_date;
                if (p.t.end_date) body.end_date = p.t.end_date;
              }
              return updateTask(token, p.t.id, body);
            }),
          );
          back.forEach(replaceTask);
          flashIds(back.map((b) => b.id));
        },
      });
      notify(`${label} to ${dest}`);
    } catch (e) {
      fail(e, "That move");
    }
  }

  async function copyTasks(group: Task[], delta: number, area: string | null) {
    try {
      const created = await Promise.all(
        group.map((t) =>
          createTask(token, {
            ...inputOf(t),
            area: area ?? t.area,
            start_date: addDaysISO(t.start_date, delta),
            end_date: t.end_date ? addDaysISO(t.end_date, delta) : null,
            status: "todo",
            progress: 0,
          }),
        ),
      );
      setTasks((prev) => [...prev, ...created]);
      flashIds(created.map((c) => c.id));
      const label = `Copied ${created.length === 1 ? `“${created[0].name}”` : plural(created.length, "task")}`;
      pushUndo({
        label,
        run: async () => {
          await Promise.all(created.map((c) => deleteTask(token, c.id)));
          const gone = new Set(created.map((c) => c.id));
          setTasks((prev) => prev.filter((x) => !gone.has(x.id)));
        },
      });
      notify(`${label} to ${shortDay(created[0].start_date)}`);
    } catch (e) {
      fail(e, "That copy");
    }
  }

  async function deleteTasks(group: Task[]) {
    if (!group.length) return;
    const what = group.length === 1 ? `“${group[0].name}”` : plural(group.length, "task");
    if (!window.confirm(`Delete ${what}? You can undo this straight after.`)) return;
    const ids = new Set(group.map((t) => t.id));
    setTasks((prev) => prev.filter((x) => !ids.has(x.id)));
    setSelected(new Set());
    setEditor(null);
    try {
      await Promise.all(group.map((t) => deleteTask(token, t.id)));
      pushUndo({
        label: `Deleted ${what}`,
        run: async () => {
          const back = await Promise.all(group.map((t) => createTask(token, inputOf(t))));
          setTasks((prev) => [...prev, ...back]);
          flashIds(back.map((b) => b.id));
        },
      });
      notify(`Deleted ${what}`);
    } catch (e) {
      fail(e, "That delete");
    }
  }

  async function quickAdd(cell: Cell, q2: QuickTask) {
    const created = await createTask(token, {
      area: cell.area,
      name: q2.name,
      trade: q2.trade,
      workers: q2.workers,
      hours: q2.hours,
      start_date: cell.iso,
      end_date: null,
      status: "todo",
      priority: "normal",
      progress: 0,
    });
    try {
      localStorage.setItem(TRADE_KEY, q2.trade);
    } catch {
      /* ignore */
    }
    setTasks((prev) => [...prev, created]);
    flashIds([created.id]);
    pushUndo({
      label: `Added “${created.name}”`,
      run: async () => {
        await deleteTask(token, created.id);
        setTasks((prev) => prev.filter((x) => x.id !== created.id));
      },
    });
  }

  function addArea() {
    const name = (newArea ?? "").trim();
    setNewArea(null);
    if (!name) return;
    const existing = allAreas.find((a) => a.toLowerCase() === name.toLowerCase());
    if (!existing) setExtraAreas((prev) => [...prev, name]);
    setActiveOnly(false);
    setQueryLive("");
    setQuery("");
  }

  // ---------- drag & drop ----------
  function evaluate(d: Drag, cell: Cell): Target {
    const delta = daysBetween(d.grabIso, cell.iso);
    const rowChange = cell.area !== d.fromArea;
    const n = d.ids.length;
    const verb = d.copy ? "Copy" : "Move";
    const what = n > 1 ? ` ${n} tasks` : "";
    if (offSet.has(cell.iso)) return { ...cell, tone: "no", tip: "Off day — can't schedule here" };
    if (rowChange && !fullEdit) return { ...cell, tone: "no", tip: "You can change dates, not areas" };
    if (!rowChange && delta === 0 && !d.copy) return { ...cell, tone: "idle", tip: "Drop somewhere else to move" };
    return {
      ...cell,
      tone: "ok",
      tip: `${verb}${what} → ${rowChange ? `${cell.area} · ` : ""}${shortDay(cell.iso)}`,
    };
  }

  /** Paint the hovered cell and the tip under the ghost by hand — going
   * through React here would re-render the whole grid on every pointer move. */
  function paintTarget(cellEl: HTMLElement | null, t: Target | null) {
    const prev = dropRef.current;
    if (prev && prev !== cellEl) prev.classList.remove(...DROP_CLASSES);
    dropRef.current = cellEl;
    if (cellEl) {
      cellEl.classList.remove(...DROP_CLASSES);
      if (t) cellEl.classList.add(`drop-${t.tone}`);
    }
    const tip = tipRef.current;
    if (tip) {
      tip.textContent = t?.tip ?? "";
      tip.className = `pl-ghost-tip ${t?.tone ?? ""}`;
      tip.hidden = !t;
    }
  }

  function retarget() {
    const d = dragRef.current;
    if (!d) return;
    const cellAt = (x: number) =>
      (document.elementFromPoint(x, d.y) as HTMLElement | null)?.closest<HTMLElement>("[data-cell]");
    // Just inside the right edge sits the scrollbar; look a little further in.
    const cellEl = cellAt(d.x) ?? cellAt(d.x - 24);
    const next = cellEl ? evaluate(d, { area: cellEl.dataset.area!, iso: cellEl.dataset.iso! }) : null;
    const key = next ? `${next.area}|${next.iso}|${next.tip}` : "";
    // The cell check also repaints after the grid re-renders mid-drag.
    if (key !== targetKey.current || (cellEl ?? null) !== dropRef.current) {
      targetKey.current = key;
      d.target = next;
      paintTarget(cellEl ?? null, next);
    }
  }

  function positionGhost() {
    const d = dragRef.current;
    const g = ghostRef.current;
    if (d && g) g.style.transform = `translate(${d.x - d.offX}px, ${d.y - d.offY}px)`;
  }

  function beginDrag(p: Press) {
    const rect = p.el.getBoundingClientRect();
    const sel = live.current.selected;
    const ids = sel.has(p.task.id) ? [...sel] : [p.task.id];
    const d: Drag = {
      ids,
      lead: p.task,
      grabIso: p.iso,
      fromArea: p.task.area,
      x: p.x,
      y: p.y,
      offX: Math.min(p.x - rect.left, rect.width - 12),
      offY: p.y - rect.top,
      w: rect.width,
      copy: false,
      target: null,
    };
    dragRef.current = d;
    targetKey.current = "";
    setDrag(d);
    setEditor(null);
    setComposer(null);
    document.body.classList.add("pl-grabbing");
    if (p.touch) navigator.vibrate?.(8);
  }

  function endDrag() {
    pressRef.current?.detach();
    pressRef.current = null;
    dragRef.current = null;
    targetKey.current = "";
    paintTarget(null, null);
    document.body.classList.remove("pl-grabbing");
    setDrag(null);
    setEdge(0);
  }

  function commitDrop(d: Drag) {
    const t = d.target;
    if (!t || t.tone !== "ok") return;
    const group = live.current.tasks.filter((x) => d.ids.includes(x.id));
    const delta = daysBetween(d.grabIso, t.iso);
    const area = t.area !== d.fromArea ? t.area : null;
    if (d.copy) copyTasks(group, delta, area);
    else moveTasks(group, delta, area);
  }

  function onCardDown(e: RPointerEvent<HTMLElement>, t: Task, iso: string, el: HTMLElement) {
    if (e.button !== 0 || !user || e.metaKey || e.ctrlKey || e.shiftKey) return;
    pressRef.current?.detach();
    const press: Press = {
      x: e.clientX,
      y: e.clientY,
      task: t,
      iso,
      el,
      touch: e.pointerType !== "mouse",
      timer: null,
      detach: () => {},
    };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) {
        const dist = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
        if (press.touch) {
          if (dist > 8) finish(); // a swipe, not a long-press: let the grid scroll
          return;
        }
        if (dist < 5) return;
        press.x = ev.clientX;
        press.y = ev.clientY;
        beginDrag(press);
        return;
      }
      d.x = ev.clientX;
      d.y = ev.clientY;
      d.copy = ev.altKey && live.current.fullEdit;
      positionGhost();
    };
    const up = () => {
      const d = dragRef.current;
      if (d) {
        suppressClickUntil.current = Date.now() + 400;
        live.current.retarget();
        live.current.commitDrop(d);
      }
      finish();
    };
    const cancel = () => finish();
    const finish = () => {
      if (dragRef.current) endDrag();
      else press.detach();
      if (pressRef.current === press) pressRef.current = null;
    };
    press.detach = () => {
      if (press.timer) window.clearTimeout(press.timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    if (press.touch) {
      press.timer = window.setTimeout(() => {
        if (pressRef.current === press) beginDrag(press);
      }, 320);
    }
    pressRef.current = press;
  }

  // While dragging: follow the pointer, auto-scroll near the edges, and page to
  // the previous/next week when held against an edge that can't scroll further.
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    let edgeDir = 0;
    let edgeSince = 0;
    let shown = 0;
    const blockTouch = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endDrag();
      const d = dragRef.current;
      if (d && e.key === "Alt") d.copy = e.type === "keydown" && live.current.fullEdit;
    };
    const tick = (now: number) => {
      const d = dragRef.current;
      const sc = scrollRef.current;
      if (!d || !sc) return;
      const r = sc.getBoundingClientRect();
      const areaW = sc.querySelector<HTMLElement>(".pl-corner")?.offsetWidth ?? 0;
      const headH = sc.querySelector<HTMLElement>(".pl-head")?.offsetHeight ?? 0;
      const inY = d.y > r.top && d.y < r.bottom;
      // The edge strips (and the area column) scroll the grid, then page weeks.
      let dir = 0;
      if (inY && d.x > r.left - 40 && d.x < r.left + areaW + EDGE) dir = -1;
      else if (inY && d.x > r.right - EDGE && d.x < r.right + 40) dir = 1;
      let hot = 0;
      if (dir) {
        const canScroll = dir < 0 ? sc.scrollLeft > 0 : sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1;
        if (canScroll) {
          sc.scrollLeft += dir * 14;
          edgeDir = 0;
        } else {
          hot = dir;
          if (edgeDir !== dir) {
            edgeDir = dir;
            edgeSince = now;
          } else if (now - edgeSince > 750) {
            edgeSince = now;
            setFrom((f) => addDaysISO(f, dir * 7));
          }
        }
      } else edgeDir = 0;
      if (hot !== shown) {
        shown = hot;
        setEdge(hot as -1 | 0 | 1);
      }
      if (d.x > r.left && d.x < r.right) {
        if (d.y < r.top + headH + 30 && d.y > r.top - 30) sc.scrollTop -= 12;
        else if (d.y > r.bottom - 30 && d.y < r.bottom + 60) sc.scrollTop += 12;
      }
      live.current.retarget();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("touchmove", blockTouch, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("touchmove", blockTouch);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [dragging]);

  // Latest values for the long-lived drag and keyboard handlers.
  const live = useRef({ tasks, selected, fullEdit, commitDrop, retarget, undoLast, deleteTasks, applyZoom, syncZoom });
  live.current = { tasks, selected, fullEdit, commitDrop, retarget, undoLast, deleteTasks, applyZoom, syncZoom };

  // ---------- selection, clicks, keyboard ----------
  function onCardClick(e: RMouseEvent<HTMLElement>, t: Task, el: HTMLElement) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
      return;
    }
    setSelected(new Set());
    setEditor({ id: t.id, rect: el.getBoundingClientRect() });
  }

  function openComposer(cell: Cell, el: HTMLElement) {
    if (!fullEdit || offSet.has(cell.iso)) return;
    setComposer({ ...cell, rect: el.getBoundingClientRect() });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (typing || dragRef.current || document.querySelector(".pl-pop, .sheet, .overlay")) return;
      if (e.key === "Escape") setSelected(new Set());
      else if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        live.current.applyZoom(e.key === "ArrowUp" ? ZOOM_STEP : 1 / ZOOM_STEP);
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        live.current.undoLast();
      } else if ((e.key === "Delete" || e.key === "Backspace") && live.current.fullEdit && live.current.selected.size) {
        e.preventDefault();
        const ids = live.current.selected;
        live.current.deleteTasks(live.current.tasks.filter((t) => ids.has(t.id)));
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedTasks = tasks.filter((t) => selected.has(t.id));
  const editing = editor ? tasks.find((t) => t.id === editor.id) ?? null : null;
  const nFilters = fTrades.size + (hideDone ? 1 : 0) + (activeOnly ? 1 : 0);
  const mod = IS_MAC ? "⌘" : "Ctrl";
  const alt = IS_MAC ? "⌥" : "Alt";

  // Which cards look selected, just-changed or picked up is painted onto the
  // DOM after each render: putting it in the grid's props would mean
  // re-rendering every cell each time you tap a card.
  const marks = useRef({ sel: NO_IDS, flash: NO_IDS, src: NO_IDS, on: false });
  marks.current.sel = selected;
  marks.current.flash = flash;
  marks.current.src = drag ? new Set(drag.ids) : NO_IDS;
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const { sel, flash: fl, src } = marks.current;
    const any = sel.size > 0 || fl.size > 0 || src.size > 0;
    if (!sc || (!any && !marks.current.on)) return;
    marks.current.on = any;
    for (const el of sc.querySelectorAll<HTMLElement>("[data-tid]")) {
      const id = Number(el.dataset.tid);
      el.classList.toggle("is-sel", sel.has(id));
      el.classList.toggle("is-flash", fl.has(id));
      el.classList.toggle("is-src", src.has(id));
    }
  });

  // ---------- render ----------
  // The grid is one memoised block with a single set of listeners on the
  // scroller: cards and cells carry their ids in data attributes.
  const dim = useCallback((t: Task) => !!q && !matches(t), [q, matches]);

  function onGridClick(e: RMouseEvent<HTMLDivElement>) {
    if (Date.now() < suppressClickUntil.current) return;
    const el = e.target as HTMLElement;
    const act = el.closest<HTMLElement>("[data-act]");
    if (act) {
      const what = act.dataset.act;
      if (what === "done") {
        const t = taskById(act.closest<HTMLElement>("[data-tid]")?.dataset.tid);
        if (t) toggleDone(t);
      } else if (what === "more") {
        const key = act.dataset.key!;
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(key)) next.add(key);
          return next;
        });
      } else if (what === "rm-area") {
        const area = act.dataset.area!;
        setExtraAreas((prev) => prev.filter((a) => a !== area));
      }
      return;
    }
    const card = el.closest<HTMLElement>("[data-tid]");
    if (card) {
      const t = taskById(card.dataset.tid);
      if (t) onCardClick(e, t, card);
      return;
    }
    // Clicking empty space in a cell adds a task there — unless a selection is
    // open, where clearing it is what you want.
    const cell = el.closest<HTMLElement>("[data-cell]");
    if (!cell) return;
    if (selected.size) setSelected(new Set());
    else if (cell.hasAttribute("data-add")) openComposer({ area: cell.dataset.area!, iso: cell.dataset.iso! }, cell);
  }

  function onGridKey(e: RKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target as HTMLElement;
    if (el.closest("button, input, select, a")) return;
    const card = el.closest<HTMLElement>("[data-tid]");
    const t = card && taskById(card.dataset.tid);
    if (!t || !card) return;
    e.preventDefault();
    setEditor({ id: t.id, rect: card.getBoundingClientRect() });
  }

  const ghost = dragRef.current;

  return (
    <AppShell
      title="Planner"
      titleIcon={<IconGrid />}
      wide
      actions={
        fullEdit ? (
          <button className="btn btn-primary" type="button" onClick={() => setModal(true)}>
            <IconPlus />Add task
          </button>
        ) : null
      }
    >
      {error && (
        <div className="error-banner pl-error">
          <span>{error}</span>
          <button type="button" className="g-link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="pl-bar">
        <div className="pl-nav">
          <button className="icon-btn" type="button" aria-label="Previous period" onClick={() => shift(-1)}>
            <IconChevronLeft />
          </button>
          <button className="btn btn-secondary" type="button" onClick={goToday}>Today</button>
          <button className="icon-btn" type="button" aria-label="Next period" onClick={() => shift(1)}>
            <IconChevronRight />
          </button>
          <div className="g-filter-wrap">
            <button
              type="button"
              className="pl-range"
              title="Jump to a date"
              aria-expanded={jumpOpen}
              onClick={() => setJumpOpen((v) => !v)}
            >
              {fmtRange(from, to)}
            </button>
            {jumpOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setJumpOpen(false)} />
                <div className="g-pop pl-jump-pop">
                  <div className="g-pop-head"><b>Jump to</b></div>
                  <label className="field">
                    <span className="label">{period.kind === "weeks" ? "Week of" : "Starting"}</span>
                    <input
                      type="date"
                      className="input mono"
                      value={from}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setFrom(period.kind === "weeks" ? mondayOf(v) : v);
                        setJumpOpen(false);
                      }}
                    />
                  </label>
                  <div className="pl-range-foot">
                    <span className="hint">{plural(len, "day")} shown</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setJumpOpen(false);
                        goToday();
                      }}
                    >
                      Today
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="g-filter-wrap pl-period">
          <div className="chips" role="group" aria-label="Period">
            {WEEKS.map((w) => (
              <button
                key={w}
                type="button"
                className="chip-btn"
                aria-pressed={period.kind === "weeks" && period.weeks === w}
                onClick={() => pickWeeks(w)}
              >
                {w === 1 ? "Week" : `${w} weeks`}
              </button>
            ))}
            <button
              type="button"
              className="chip-btn"
              aria-pressed={period.kind === "custom"}
              aria-expanded={rangeOpen}
              onClick={openCustom}
            >
              {period.kind === "custom" ? `${period.days} days` : "Custom"}
            </button>
          </div>
          {rangeOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setRangeOpen(false)} />
              <form
                className="g-pop pl-range-pop"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyCustom();
                }}
              >
                <div className="g-pop-head">
                  <b>Custom range</b>
                </div>
                {rangeDraft.err && <div className="error-banner">{rangeDraft.err}</div>}
                <div className="form-row">
                  <label className="field">
                    <span className="label">From</span>
                    <input
                      type="date"
                      className="input mono"
                      value={rangeDraft.from}
                      onChange={(e) => setRangeDraft({ ...rangeDraft, from: e.target.value, err: "" })}
                    />
                  </label>
                  <label className="field">
                    <span className="label">To</span>
                    <input
                      type="date"
                      className="input mono"
                      value={rangeDraft.to}
                      min={rangeDraft.from || undefined}
                      onChange={(e) => setRangeDraft({ ...rangeDraft, to: e.target.value, err: "" })}
                    />
                  </label>
                </div>
                <div className="pl-range-foot">
                  <span className="hint">
                    {rangeDraft.from && rangeDraft.to && rangeDraft.to >= rangeDraft.from
                      ? plural(daysBetween(rangeDraft.from, rangeDraft.to) + 1, "day")
                      : `Up to ${MAX_CUSTOM_DAYS} days`}
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={() => setRangeOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Show</button>
                </div>
              </form>
            </>
          )}
        </div>

        <div className="search-wrap pl-search">
          <IconSearch />
          <input
            ref={searchRef}
            className="input"
            placeholder="Find tasks, areas, trades…"
            value={queryLive}
            onChange={(e) => setQueryLive(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setQueryLive("");
              e.currentTarget.blur();
            }}
            aria-label="Find in planner"
          />
          {queryLive && (
            <button type="button" className="g-search-x" onClick={() => setQueryLive("")} aria-label="Clear search">
              <IconClose />
            </button>
          )}
        </div>

        <div className="g-filter-wrap pl-filters">
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
                  <button
                    type="button"
                    className="g-link"
                    disabled={!nFilters}
                    onClick={() => {
                      setFTrades(new Set());
                      setHideDone(false);
                      setActiveOnly(false);
                    }}
                  >
                    Clear all
                  </button>
                </div>
                <div className="g-pop-sec">
                  <label>Trade</label>
                  <div className="g-pop-tags">
                    {presentTrades.map((tr) => (
                      <button
                        key={tr}
                        type="button"
                        className={`g-tag ${tradeCls(tr)}`}
                        aria-pressed={fTrades.has(tr)}
                        onClick={() =>
                          setFTrades((s) => {
                            const next = new Set(s);
                            if (next.has(tr)) next.delete(tr);
                            else next.add(tr);
                            return next;
                          })
                        }
                      >
                        <i />
                        {tr}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="g-pop-sec">
                  <label>Show</label>
                  <div className="g-pop-tags">
                    <button type="button" className="g-tag" aria-pressed={hideDone} onClick={() => setHideDone((v) => !v)}>
                      Hide finished tasks
                    </button>
                    <button type="button" className="g-tag" aria-pressed={activeOnly} onClick={() => setActiveOnly((v) => !v)}>
                      Only areas with work this period
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <span className="spacer" />

        <div className="zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => applyZoom(1 / ZOOM_STEP)}
            disabled={!zoomUi.canOut}
            aria-label="Zoom out"
            title={`Zoom out (${mod} + scroll, or ${mod}+↓)`}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => applyZoom(ZOOM_STEP)}
            disabled={!zoomUi.canIn}
            aria-label="Zoom in"
            title={`Zoom in (${mod} + scroll, or ${mod}+↑)`}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="btn btn-secondary pl-undo"
          onClick={undoLast}
          disabled={!undoCount}
          title={`Undo (${mod}+Z)`}
          aria-label="Undo"
        >
          <IconRollover /><span>Undo</span>
        </button>
      </div>

      <div className="pl-sub">
        <span className="mono">
          {plural(periodStats.total, "task")} this period
          {periodStats.done > 0 && ` · ${periodStats.done} done`}
          {periodStats.late > 0 && <> · <span className="late">{periodStats.late} overdue</span></>}
        </span>
        {!isPhone && (
          <span className="pl-tips">
            {fullEdit
              ? `Drag to move · ${alt}-drag to copy · ${mod}-click to pick several · click an empty cell to add · ${mod}+scroll to zoom`
              : "Drag a task along its row to change its date · click to rename"}
          </span>
        )}
        {isPhone && <span className="pl-tips">Hold a task to drag it · tap a cell to add</span>}
        <span className="spacer" />
        <span className="cal-legend pl-legend">
          {legend.map((tr) => (
            <span key={tr} className={`legend-item ${tradeCls(tr)}`}><i />{tr}</span>
          ))}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="pl-selbar">
          <b>{selected.size} selected</b>
          <span className="pl-tips">Drag any of them to move them together</span>
          <span className="spacer" />
          {fullEdit && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  const open = selectedTasks.filter((t) => t.status !== "done");
                  for (const t of open) await saveTask(t, { status: "done" }, "Marked done");
                  if (open.length > 1) notify(`Marked ${plural(open.length, "task")} done`);
                }}
              >
                <IconCheck />Mark done
              </button>
              <button type="button" className="btn btn-danger" onClick={() => deleteTasks(selectedTasks)}>
                <IconTrash />Delete
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className={`data-card pl-wrap ${drag ? "is-dragging" : ""}`}>
        {loading ? (
          <div className="empty">Loading planner…</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>{q ? "Nothing matches that search this period" : "No areas to show"}</h3>
            <p className="hint">
              {q ? "Try another word, or move to a different week." : fullEdit ? "Add an area below or add a task to get started." : "Tasks will appear here once they're scheduled."}
            </p>
          </div>
        ) : null}
        {!loading && (
          <>
            <div
              className={`pl-scroll ${drag ? "pl-dragging" : ""}`}
              ref={scrollRef}
              onPointerDown={onGridDown}
              onClick={onGridClick}
              onKeyDown={onGridKey}
              // A long press on a card is a drag, not a context menu.
              onContextMenu={(e) => (e.target as HTMLElement).closest(".pc") && e.preventDefault()}
              style={{ "--pl-cols": cols, "--pl-lanes-w": lanesW, "--pl-col-w": `${colW}px` } as CSSProperties}
            >
              <div className="pl-grid">
                {rows.length > 0 && (
                  <GridBody
                    rows={rows}
                    days={days}
                    today={today}
                    offSet={offSet}
                    collapsed={collapsed}
                    expanded={expanded}
                    limit={CARD_LIMIT[zoomUi.tier]}
                    fullEdit={fullEdit}
                    dim={dim}
                  />
                )}

                {fullEdit && (
                  <div className="pl-row pl-addrow">
                    <div className="pl-area">
                      {newArea === null ? (
                        <button type="button" className="pl-addarea" onClick={() => setNewArea("")}>
                          <IconPlus />Add area
                        </button>
                      ) : (
                        <input
                          className="input"
                          autoFocus
                          placeholder="Area name"
                          value={newArea}
                          onChange={(e) => setNewArea(e.target.value)}
                          onBlur={addArea}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setNewArea(null);
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className={`pl-edge l ${edge === -1 ? "on" : ""}`} aria-hidden="true"><IconChevronLeft /></div>
            <div className={`pl-edge r ${edge === 1 ? "on" : ""}`} aria-hidden="true"><IconChevronRight /></div>
          </>
        )}
      </div>

      {drag && ghost && (
        <div
          className="pl-ghost"
          ref={ghostRef}
          style={{ width: ghost.w, transform: `translate(${ghost.x - ghost.offX}px, ${ghost.y - ghost.offY}px)` }}
        >
          <div className={`pc ${tradeCls(ghost.lead.trade)}`}>
            <div className="pc-body"><div className="pc-name">{ghost.lead.name}</div></div>
          </div>
          {ghost.ids.length > 1 && <span className="pl-ghost-n">{ghost.ids.length}</span>}
          <div className="pl-ghost-tip" ref={tipRef} hidden />
        </div>
      )}

      {editing && editor && (
        <TaskEditor
          key={editing.id}
          task={editing}
          anchor={editor.rect}
          sheet={isPhone}
          full={fullEdit}
          areas={allAreas}
          onSave={(body, label) => saveTask(editing, body, label)}
          onDelete={() => deleteTasks([editing])}
          onDuplicate={() => {
            setEditor(null);
            copyTasks([editing], 0, null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {composer && (
        <QuickAdd
          key={`${composer.area}|${composer.iso}`}
          area={composer.area}
          iso={composer.iso}
          anchor={composer.rect}
          sheet={isPhone}
          defaultTrade={(() => {
            try {
              return localStorage.getItem(TRADE_KEY) || "Civil";
            } catch {
              return "Civil";
            }
          })()}
          onAdd={(q2) => quickAdd(composer, q2)}
          onClose={() => setComposer(null)}
        />
      )}

      {modal && (
        <TaskModal
          initial={null}
          defaultDate={today}
          onClose={() => setModal(false)}
          onSubmit={async (data) => {
            const created = await createTask(token, data);
            setTasks((prev) => [...prev, created]);
            setModal(false);
            flashIds([created.id]);
            pushUndo({
              label: `Added “${created.name}”`,
              run: async () => {
                await deleteTask(token, created.id);
                setTasks((prev) => prev.filter((x) => x.id !== created.id));
              },
            });
            notify(`Added “${created.name}” to ${created.area}`);
          }}
        />
      )}

      <SaveAlert failure={failure} onDismiss={() => setFailure(null)} />

      {toast && (
        <div className="pl-toast" role="status" key={toast.n}>
          <span>{toast.text}</span>
          {toast.undo && undoCount > 0 && (
            <button type="button" onClick={undoLast}>Undo</button>
          )}
          <button type="button" aria-label="Dismiss" className="pl-toast-x" onClick={() => setToast(null)}>
            <IconClose />
          </button>
        </div>
      )}
    </AppShell>
  );
}
