import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { StatusControl } from "../components/StatusControl";
import { useAuth } from "../auth/AuthContext";
import {
  IconDashboard,
  IconClock,
  IconAlert,
  IconCalendar,
  IconFlag,
  IconCheck,
} from "../components/icons";
import { listTasks, updateTask } from "../lib/tasks";
import type { Task, TaskStatus } from "../lib/tasks";
import { todayISO, addDaysISO, fmtShort, fmtDay } from "../lib/dates";
import type { ApiError } from "../lib/api";

function dueDate(t: Task) {
  return t.end_date ?? t.start_date;
}

// Dashboard panels are summaries — cap the rows and link out for the rest.
const MAX_ROWS = 8;
function MoreLink({ total, to }: { total: number; to: string }) {
  if (total <= MAX_ROWS) return null;
  return <Link className="dt-more" to={to}>+{total - MAX_ROWS} more — view all</Link>;
}
function daysLate(t: Task, today: string) {
  const ms = new Date(today + "T00:00:00").getTime() - new Date(dueDate(t) + "T00:00:00").getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export default function Dashboard() {
  const { token, user } = useAuth();
  const isContractor = user?.role === "contractor";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTasks(token)
      .then(setTasks)
      .catch((e) => setError((e as ApiError)?.message ?? "Could not load tasks"))
      .finally(() => setLoading(false));
  }, [token]);

  async function changeStatus(t: Task, status: TaskStatus) {
    try {
      const u = await updateTask(token, t.id, { status });
      setTasks((prev) => prev.map((x) => (x.id === u.id ? u : x)));
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not update status");
    }
  }

  const today = todayISO();
  const d = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done");
    const byDue = (a: Task, b: Task) => dueDate(a).localeCompare(dueDate(b));
    const prioFirst = (a: Task, b: Task) =>
      (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) || byDue(a, b);
    const weekAhead = addDaysISO(today, 7);

    const counts = { all: tasks.length, todo: 0, in_progress: 0, done: 0, overdue: 0 };
    for (const t of tasks) {
      counts[t.status]++;
      if (t.status !== "done" && dueDate(t) < today) counts.overdue++;
    }
    return {
      counts,
      donePct: counts.all ? Math.round((counts.done / counts.all) * 100) : 0,
      overallPct: counts.all
        ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / counts.all)
        : 0,
      todayTasks: open
        .filter((t) => t.start_date <= today && dueDate(t) >= today)
        .sort(prioFirst),
      overdue: open.filter((t) => dueDate(t) < today).sort(prioFirst),
      upcoming: open
        .filter((t) => t.start_date > today && t.start_date <= weekAhead)
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || prioFirst(a, b)),
      milestones: open
        .filter((t) => dueDate(t) >= today)
        .sort(byDue)
        .slice(0, 6),
      attention: open.filter((t) => t.priority === "high").sort(byDue),
      areas: [...new Set(tasks.map((t) => t.area))].map((area) => {
        const ts = tasks.filter((t) => t.area === area);
        return {
          area,
          pct: Math.round(ts.reduce((s, t) => s + t.progress, 0) / ts.length),
          done: ts.filter((t) => t.status === "done").length,
          total: ts.length,
        };
      }),
    };
  }, [tasks, today]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.split(/\s+/)[0] ?? "";

  return (
    <AppShell title="Dashboard" titleIcon={<IconDashboard />}>
      {error && <div className="error-banner">{error}</div>}

      <div className="dash-hello">
        <h1>{greeting}, {firstName}</h1>
        <p className="hint">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {" · "}
          {isContractor
            ? `${d.todayTasks.length} task${d.todayTasks.length === 1 ? "" : "s"} on site today, ${d.counts.overdue} overdue`
            : `Project is ${d.overallPct}% complete`}
        </p>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : isContractor ? (
        <>
          <div className="stat-row">
            <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--accent)" }} />Total tasks</div><div className="v">{d.counts.all}</div></div>
            <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--done-fg)" }} />Done</div><div className="v">{d.counts.done}<small>{d.donePct}%</small></div></div>
            <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--prog-fg)" }} />In progress</div><div className="v">{d.counts.in_progress}</div></div>
            <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--todo-fg)" }} />To do</div><div className="v">{d.counts.todo}</div></div>
            <div className="stat"><div className="k"><span className="dot" style={{ background: "var(--danger)" }} />Overdue</div><div className="v">{d.counts.overdue}</div></div>
          </div>

          <div className="dash-grid">
            <section className="panel">
              <header className="panel-head">
                <IconClock /><h2>Today</h2><span className="panel-count">{d.todayTasks.length}</span>
                <Link className="panel-link" to="/tasks">View all</Link>
              </header>
              {d.todayTasks.length === 0 ? (
                <div className="panel-empty"><IconCheck />Nothing scheduled for today.</div>
              ) : (
                <>
                  {d.todayTasks.slice(0, MAX_ROWS).map((t) => (
                    <div key={t.id} className={`dt-row ${t.priority === "high" ? "is-high" : ""}`}>
                      <div className="dt-main">
                        <div className="dt-name">
                          {t.priority === "high" && <span className="prio-badge"><IconFlag />High priority</span>}
                          {t.name}
                        </div>
                        <div className="dt-meta">{t.area} · {t.trade || "—"} · {t.workers}w · {t.hours}h</div>
                      </div>
                      <StatusControl value={t.status} editable onChange={(s) => changeStatus(t, s)} />
                    </div>
                  ))}
                  <MoreLink total={d.todayTasks.length} to="/tasks" />
                </>
              )}
            </section>

            <section className="panel panel-danger">
              <header className="panel-head">
                <IconAlert /><h2>Overdue</h2><span className="panel-count danger">{d.overdue.length}</span>
                <Link className="panel-link" to="/tasks">View all</Link>
              </header>
              {d.overdue.length === 0 ? (
                <div className="panel-empty"><IconCheck />Nothing overdue. Great work.</div>
              ) : (
                <>
                  {d.overdue.slice(0, MAX_ROWS).map((t) => (
                    <div key={t.id} className={`dt-row ${t.priority === "high" ? "is-high" : ""}`}>
                      <div className="dt-main">
                        <div className="dt-name">
                          {t.priority === "high" && <span className="prio-badge"><IconFlag />High priority</span>}
                          {t.name}
                        </div>
                        <div className="dt-meta">
                          {t.area} · due {fmtShort(dueDate(t))} · <span className="late">{daysLate(t, today)}d late</span>
                        </div>
                      </div>
                      <StatusControl value={t.status} editable onChange={(s) => changeStatus(t, s)} />
                    </div>
                  ))}
                  <MoreLink total={d.overdue.length} to="/tasks" />
                </>
              )}
            </section>

            <section className="panel panel-wide">
              <header className="panel-head">
                <IconCalendar /><h2>Coming up</h2><span className="panel-count">{d.upcoming.length}</span>
                <Link className="panel-link" to="/calendar">Open calendar</Link>
              </header>
              {d.upcoming.length === 0 ? (
                <div className="panel-empty">Nothing scheduled in the next 7 days.</div>
              ) : (
                <>
                  {d.upcoming.slice(0, MAX_ROWS).map((t) => (
                    <div key={t.id} className={`dt-row ${t.priority === "high" ? "is-high" : ""}`}>
                      <span className="dt-date">{fmtShort(t.start_date)}</span>
                      <div className="dt-main">
                        <div className="dt-name">
                          {t.priority === "high" && <span className="prio-badge"><IconFlag />High priority</span>}
                          {t.name}
                        </div>
                        <div className="dt-meta">{t.area} · {t.trade || "—"}</div>
                      </div>
                    </div>
                  ))}
                  <MoreLink total={d.upcoming.length} to="/calendar" />
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="dash-grid">
          <section className="panel panel-wide">
            <header className="panel-head">
              <IconDashboard /><h2>Project progress</h2>
            </header>
            <div className="prog-hero">
              <div className="prog-num">{d.overallPct}<small>%</small></div>
              <div className="prog-detail">
                <div className={`progress big ${d.overallPct >= 100 ? "is-done" : ""}`}><span style={{ width: `${d.overallPct}%` }} /></div>
                <div className="hint" style={{ marginTop: 8 }}>
                  {d.counts.done} of {d.counts.all} tasks complete · {d.counts.in_progress} in progress
                  {d.counts.overdue > 0 && <> · <span className="late">{d.counts.overdue} running late</span></>}
                </div>
              </div>
            </div>
            <div className="area-list">
              {d.areas.map((a) => (
                <div key={a.area} className="area-row">
                  <span className="area-name">{a.area}</span>
                  <div className={`progress ${a.pct >= 100 ? "is-done" : ""}`}><span style={{ width: `${a.pct}%` }} /></div>
                  <span className="area-pct">{a.pct}%</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <IconCalendar /><h2>Key upcoming dates</h2>
              <Link className="panel-link" to="/calendar">Open calendar</Link>
            </header>
            {d.milestones.length === 0 ? (
              <div className="panel-empty">No upcoming deadlines.</div>
            ) : (
              d.milestones.map((t) => (
                <div key={t.id} className={`dt-row ${t.priority === "high" ? "is-high" : ""}`}>
                  <span className="dt-date">{fmtDay(dueDate(t))}</span>
                  <div className="dt-main">
                    <div className="dt-name">
                      {t.priority === "high" && <span className="prio-badge"><IconFlag />Key item</span>}
                      {t.name}
                    </div>
                    <div className="dt-meta">{t.area} · {t.trade || "—"}</div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="panel">
            <header className="panel-head">
              <IconFlag /><h2>Awaiting your attention</h2>
              <span className="panel-count">{d.attention.length}</span>
            </header>
            {d.attention.length === 0 ? (
              <div className="panel-empty"><IconCheck />Nothing needs your attention right now.</div>
            ) : (
              <>
                {d.attention.slice(0, MAX_ROWS).map((t) => (
                  <div key={t.id} className="dt-row is-high">
                    <div className="dt-main">
                      <div className="dt-name">
                        <span className="prio-badge"><IconFlag />Needs review</span>
                        {t.name}
                      </div>
                      <div className="dt-meta">{t.area} · due {fmtShort(dueDate(t))}</div>
                    </div>
                    <span className={`pill ${t.status === "in_progress" ? "pill-prog" : "pill-todo"}`}>
                      {t.status === "in_progress" ? "In progress" : "Todo"}
                    </span>
                  </div>
                ))}
                <MoreLink total={d.attention.length} to="/tasks" />
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
