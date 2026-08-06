import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { unreadCount } from "../lib/messages";
import { Menu } from "./Menu";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconDashboard,
  IconTasks,
  IconCalendar,
  IconGantt,
  IconCart,
  IconChat,
  IconSettings,
  IconSidebar,
  IconBell,
  IconLogout,
  IconMore,
} from "./icons";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const NAV = [
  { to: "/", label: "Dashboard", icon: <IconDashboard /> },
  { to: "/tasks", label: "Tasks", icon: <IconTasks /> },
  { to: "/calendar", label: "Calendar", icon: <IconCalendar /> },
  { to: "/gantt", label: "Gantt", icon: <IconGantt /> },
  { to: "/purchases", label: "Buying & Selling", icon: <IconCart /> },
  { to: "/messages", label: "Conversations", icon: <IconChat /> },
];

// Phones get a bottom tab bar instead of the sidebar: four destinations plus a
// "More" sheet holding the rest. Shorter labels — a tab is ~78px wide.
const TABS = [
  { to: "/", label: "Home", icon: <IconDashboard /> },
  { to: "/tasks", label: "Tasks", icon: <IconTasks /> },
  { to: "/calendar", label: "Calendar", icon: <IconCalendar /> },
  { to: "/gantt", label: "Gantt", icon: <IconGantt /> },
];
const TAB_PATHS = new Set(TABS.map((t) => t.to));
const MORE = NAV.filter((item) => !TAB_PATHS.has(item.to));

const SOON = [
  { label: "Settings", icon: <IconSettings /> },
];

const SIDEBAR_KEY = "sidebar_open";

interface Props {
  title: string;
  titleIcon?: ReactNode;
  actions?: ReactNode;
  /** Lock the page to the viewport height (content scrolls internally, e.g. chat). */
  fill?: boolean;
  /** Let the content use the full width (e.g. the Gantt timeline). */
  wide?: boolean;
  children: ReactNode;
}

export function AppShell({ title, titleIcon, actions, fill, wide, children }: Props) {
  const { user, logout, token } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState<boolean>(() => {
    if (window.innerWidth <= 820) return false;
    return localStorage.getItem(SIDEBAR_KEY) !== "0";
  });
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = () => unreadCount(token).then((r) => { if (active) setUnread(r.unread); }).catch(() => {});
    poll();
    const id = setInterval(poll, 30000);
    window.addEventListener("messages-read", poll);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("messages-read", poll);
    };
  }, [token]);

  function toggle() {
    setOpen((v) => {
      localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      return !v;
    });
  }

  const roleLabel = user?.role === "contractor" ? "Contractor" : "Client";

  return (
    <div className="shell">
      <nav className={`side ${open ? "" : "side-closed"}`} aria-label="Primary">
        <div className="side-head">
          <div className="side-logo" aria-hidden="true">R</div>
          <div className="side-name">
            Remodel Project
            <span>Construction dashboard</span>
          </div>
          <button
            className="side-toggle"
            type="button"
            onClick={toggle}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
          >
            <IconSidebar />
          </button>
        </div>

        <div className="side-scroll">
          <div className="side-group">
            <div className="side-label">Navigation</div>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `side-item ${isActive ? "active" : ""}`}
                title={item.label}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.to === "/messages" && unread > 0 && <b className="nav-badge">{unread > 99 ? "99+" : unread}</b>}
              </NavLink>
            ))}
          </div>

          <div className="side-group">
            <div className="side-label">Workspace</div>
            {SOON.map((item) => (
              <button
                key={item.label}
                className="side-item soon"
                type="button"
                disabled
                title={`${item.label} — coming soon`}
              >
                {item.icon}
                <span>{item.label}</span>
                <em>Soon</em>
              </button>
            ))}
          </div>
        </div>

        <div className="side-foot">
          <Menu
            triggerClassName="side-account"
            triggerLabel="Account menu"
            align="start"
            trigger={
              <>
                <span className="side-avatar">{initials(user?.name)}</span>
                <span className="side-acc-meta">
                  <b>{user?.name}</b>
                  <i>{roleLabel}</i>
                </span>
              </>
            }
          >
            {() => (
              <>
                <div style={{ padding: "6px 10px" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{user?.name}</div>
                  <div className="hint">{user?.email}</div>
                </div>
                <div className="menu-sep" />
                <button type="button" className="danger" onClick={logout}><IconLogout />Log out</button>
              </>
            )}
          </Menu>
        </div>
      </nav>

      <div className={`app-main ${fill ? "app-main-fill" : ""}`}>
        <header className="app-top">
          <div className="app-title">{titleIcon}{title}</div>
          <div className="spacer" />
          <ThemeToggle />
          <button className="icon-btn" type="button" aria-label="Notifications"><IconBell /></button>
          {actions}
        </header>
        <div className="app-body">
          <div className={`app-body-inner ${wide ? "app-body-wide" : ""}`}>{children}</div>
        </div>
      </div>

      <nav className="tabbar" aria-label="Primary">
        {TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab ${MORE.some((m) => m.to === pathname) ? "active" : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <IconMore />
          <span>More</span>
          {unread > 0 && <i className="tab-dot" />}
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) setMoreOpen(false); }}>
          <div className="sheet-panel" role="dialog" aria-modal="true" aria-label="More">
            <div className="sheet-grab" />
            <div className="sheet-body">
              {MORE.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sheet-item ${isActive ? "active" : ""}`}
                  onClick={() => setMoreOpen(false)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.to === "/messages" && unread > 0 && <b className="nav-badge">{unread > 99 ? "99+" : unread}</b>}
                </NavLink>
              ))}
              {SOON.map((item) => (
                <button key={item.label} type="button" className="sheet-item soon" disabled>
                  {item.icon}
                  <span>{item.label}</span>
                  <em>Soon</em>
                </button>
              ))}
              <div className="menu-sep" />
              <div className="sheet-account">
                <span className="side-avatar">{initials(user?.name)}</span>
                <span className="side-acc-meta">
                  <b>{user?.name}</b>
                  <i>{user?.email}</i>
                </span>
              </div>
              <button type="button" className="sheet-item danger" onClick={logout}>
                <IconLogout />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
