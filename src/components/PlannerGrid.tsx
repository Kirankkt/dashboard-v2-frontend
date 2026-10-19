import { memo } from "react";
import type { CSSProperties } from "react";
import { tradeCls } from "./PlannerEditor";
import { IconCheck, IconFlag } from "./icons";
import type { Task } from "../lib/tasks";
import { dateOf, fmtDay } from "../lib/dates";

export type Day = { iso: string; dom: number; dow: number; weekday: string; month: string };
export type Entry = { task: Task; cont: boolean };
export type GridRow = {
  area: string;
  total: number;
  pct: number;
  extra: boolean;
  /** One bucket per day, in the same order as `days`. */
  cells: Entry[][];
};

type Props = {
  rows: GridRow[];
  days: Day[];
  today: string;
  offSet: Set<string>;
  collapsed: Set<string>;
  expanded: Set<string>;
  limit: number;
  fullEdit: boolean;
  dim: (t: Task) => boolean;
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One task card. Selection, flash and drag-source highlights are *not* props:
 * the Planner toggles those classes on the DOM so moving a card around never
 * re-renders the grid. */
function Card({ task: t, cont, today, dim, canTick }: { task: Task; cont: boolean; today: string; dim: boolean; canTick: boolean }) {
  const done = t.status === "done";
  const due = t.end_date && t.end_date > t.start_date ? t.end_date : t.start_date;
  const late = !done && due < today;
  const days = Math.round((dateOf(due).getTime() - dateOf(t.start_date).getTime()) / 86400000) + 1;
  const cls = [
    "pc",
    tradeCls(t.trade),
    cont && "pc-cont",
    done && "is-done",
    t.priority === "high" && "is-high",
    late && "is-late",
    dim && "is-dim",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      data-tid={t.id}
      role="button"
      tabIndex={0}
      title={`${t.name} · ${t.trade || "—"} · ${t.progress}%${late ? " · overdue" : ""}`}
    >
      {canTick && !cont && (
        <button
          type="button"
          className="pc-check"
          data-act="done"
          aria-label={done ? "Mark as not done" : "Mark as done"}
          aria-pressed={done}
        >
          {done && <IconCheck />}
        </button>
      )}
      <div className="pc-body">
        <div className="pc-name">
          {t.priority === "high" && !cont && <IconFlag />}
          {t.name}
        </div>
        {!cont && (
          <div className="pc-meta">
            <span>{t.workers}w · {t.hours}h</span>
            {days > 1 && <span>{days}d</span>}
            {late ? <span className="pc-late">Late</span> : t.progress > 0 && t.progress < 100 && <span>{t.progress}%</span>}
          </div>
        )}
      </div>
      {!cont && t.progress > 0 && t.progress < 100 && <i className="pc-prog" style={{ width: `${t.progress}%` }} />}
    </div>
  );
}

const MemoCard = memo(Card);

// A row the browser hasn't drawn yet still needs a height, or the scrollbar
// lies and the view jumps while you scroll. Rows are as tall as their fullest
// cell: card (~40px) plus the gap, or the empty-cell minimum.
const CARD_H = 44; // a card with its gap, at the roomier zoom levels
const CONT_H = 24; // a continuation card is one line
const ROW_PAD = 10;
const MIN_ROW_H = 84;
const MORE_H = 22;

function rowHeight(row: GridRow, days: Day[], limit: number, expanded: Set<string>) {
  let tallest = 0;
  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell.length) continue;
    const open = expanded.has(`${row.area}|${days[i].iso}`);
    const shown = open ? cell.length : Math.min(cell.length, limit);
    let h = ROW_PAD + (cell.length > limit && !open ? MORE_H : 0);
    for (let j = 0; j < shown; j++) h += cell[j].cont ? CONT_H : CARD_H;
    if (h > tallest) tallest = h;
  }
  return Math.max(MIN_ROW_H, tallest);
}

function Row({ row, days, today, offSet, collapsed, expanded, limit, fullEdit, dim }: Props & { row: GridRow }) {
  const style = { containIntrinsicSize: `auto ${rowHeight(row, days, limit, expanded)}px` } as CSSProperties;
  return (
    <div className="pl-row" style={style}>
      <div className="pl-area">
        <b>{row.area}</b>
        {row.total > 0 ? (
          <>
            <span>{plural(row.total, "task")} · {row.pct}%</span>
            <div className={`progress ${row.pct >= 100 ? "is-done" : ""}`}><span style={{ width: `${row.pct}%` }} /></div>
          </>
        ) : (
          <span>
            No tasks yet
            {row.extra && fullEdit && (
              <button type="button" className="g-link pl-area-x" data-act="rm-area" data-area={row.area}>Remove</button>
            )}
          </span>
        )}
      </div>
      {days.map((d, i) => {
        const entries = row.cells[i];
        const thin = collapsed.has(d.iso);
        const key = `${row.area}|${d.iso}`;
        const open = expanded.has(key);
        const shown = thin ? [] : open ? entries : entries.slice(0, limit);
        const off = offSet.has(d.iso);
        const cls = ["pl-cell", off && "off", d.iso === today && "today", thin && "thin"].filter(Boolean).join(" ");
        return (
          <div
            key={d.iso}
            className={cls}
            data-cell=""
            data-area={row.area}
            data-iso={d.iso}
            {...(fullEdit && !off && !thin ? { "data-add": "" } : null)}
          >
            {shown.map((entry) => (
              <MemoCard
                key={entry.task.id}
                task={entry.task}
                cont={entry.cont}
                today={today}
                dim={dim(entry.task)}
                canTick={fullEdit}
              />
            ))}
            {!thin && entries.length > limit && (
              <button type="button" className="pl-more" data-act="more" data-key={key}>
                {open ? "Show less" : `+${entries.length - limit} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Same tasks, in the same places? Then the row's output is identical and
 *  React can leave its whole subtree alone — which is what keeps editing one
 *  task off the other thirty rows. */
function sameCells(a: Entry[][], b: Entry[][]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.length !== y.length) return false;
    for (let j = 0; j < x.length; j++) {
      if (x[j].task !== y[j].task || x[j].cont !== y[j].cont) return false;
    }
  }
  return true;
}

const MemoRow = memo(
  Row,
  (a, b) =>
    a.limit === b.limit &&
    a.fullEdit === b.fullEdit &&
    a.dim === b.dim &&
    a.today === b.today &&
    a.days === b.days &&
    a.offSet === b.offSet &&
    a.collapsed === b.collapsed &&
    a.expanded === b.expanded &&
    a.row.area === b.row.area &&
    a.row.total === b.row.total &&
    a.row.pct === b.row.pct &&
    a.row.extra === b.row.extra &&
    sameCells(a.row.cells, b.row.cells),
);

/** The grid's head and body. Everything here is derived from the schedule, so
 * React only has to touch it when the schedule, the period or a filter changes
 * — clicks, drags and selections leave it alone. */
function GridBody(props: Props) {
  const { rows, days, today, offSet, collapsed } = props;
  return (
    <>
      <div className="pl-row pl-head">
        <div className="pl-corner">
          Area <span className="panel-count">{rows.length}</span>
        </div>
        {days.map((d) => {
          const thin = collapsed.has(d.iso);
          return (
            <div
              key={d.iso}
              className={`pl-dh ${offSet.has(d.iso) ? "off" : ""} ${d.iso === today ? "today" : ""} ${thin ? "thin" : ""}`}
              title={fmtDay(d.iso)}
            >
              {thin ? (
                <em>{d.weekday.slice(0, 1)}</em>
              ) : (
                <>
                  {d.month && <i>{d.month}</i>}
                  <em>{d.weekday}</em>
                  <b>{d.dom}</b>
                </>
              )}
            </div>
          );
        })}
      </div>
      {rows.map((r) => (
        <MemoRow key={r.area} row={r} {...props} />
      ))}
    </>
  );
}

export default memo(GridBody);
