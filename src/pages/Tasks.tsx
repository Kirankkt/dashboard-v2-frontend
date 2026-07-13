import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Menu } from "../components/Menu";
import { StatusControl } from "../components/StatusControl";
import { TaskModal } from "../components/TaskModal";
import { useAuth } from "../auth/AuthContext";
import { IconTasks, IconPlus, IconRollover, IconMore, IconEdit, IconTrash, IconFlag } from "../components/icons";
import { listTasks, createTask, updateTask, deleteTask, rolloverTasks } from "../lib/tasks";
import type { Task, TaskStatus, TaskInput } from "../lib/tasks";
import type { ApiError } from "../lib/api";

type Filter = "all" | TaskStatus;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function isOverdue(t: Task) {
  if (t.status === "done") return false;
  return (t.end_date ?? t.start_date) < today();
}

export default function Tasks() {
  const { token, user } = useAuth();
  const canEdit = user?.role === "contractor";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

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

  const counts = useMemo(() => {
    const c = { all: tasks.length, todo: 0, in_progress: 0, done: 0, overdue: 0 };
    for (const t of tasks) {
      c[t.status]++;
      if (isOverdue(t)) c.overdue++;
    }
    return c;
  }, [tasks]);
  const donePct = counts.all ? Math.round((counts.done / counts.all) * 100) : 0;

  const visible = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

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
  async function rollover() {
    if (!window.confirm("Move all unfinished tasks due today or earlier to the next working day?")) return;
    try {
      const res = await rolloverTasks(token);
      await load();
      window.alert(`Moved ${res.moved} task(s) forward to ${fmtDate(res.moved_to)}.`);
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not roll over");
    }
  }

  const actions = canEdit ? (
    <>
      <button className="btn btn-secondary" type="button" onClick={rollover}><IconRollover />Roll over</button>
      <button className="btn btn-primary" type="button" onClick={() => setModal({ open: true, task: null })}><IconPlus />Add task</button>
    </>
  ) : null;

  const chips: [Filter, string, number][] = [
    ["all", "All", counts.all],
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
      </div>

      <div className="data-card">
        {loading ? (
          <div className="empty">Loading tasks…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <h3>{filter === "all" ? "No tasks yet" : "Nothing here"}</h3>
            <p className="hint">{canEdit ? "Add your first task to start planning the build." : "Tasks will appear here once the contractor adds them."}</p>
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task</th><th>Area</th><th>Crew</th><th>Progress</th><th>Dates</th><th>Status</th>{canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="t-name">
                        {t.priority === "high" && <span className="prio-badge"><IconFlag />High</span>}
                        {t.name}
                      </div>
                      <div className="t-sub">{t.trade || "—"}</div>
                    </td>
                    <td>{t.area}</td>
                    <td className="num">{t.workers} · {t.hours}h</td>
                    <td style={{ minWidth: 120 }}>
                      <div className={`progress ${t.progress >= 100 ? "is-done" : ""}`}><span style={{ width: `${t.progress}%` }} /></div>
                    </td>
                    <td className="num">
                      {fmtDate(t.start_date)}
                      {t.end_date && t.end_date !== t.start_date ? ` → ${fmtDate(t.end_date)}` : ""}
                      {isOverdue(t) && <span style={{ color: "var(--danger)", marginLeft: 6 }} title="Overdue">!</span>}
                    </td>
                    <td><StatusControl value={t.status} editable={!!canEdit} onChange={(s) => changeStatus(t, s)} /></td>
                    {canEdit && (
                      <td>
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
    </AppShell>
  );
}
