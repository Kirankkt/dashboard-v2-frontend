import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Menu } from "./Menu";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconDashboard,
  IconTasks,
  IconCalendar,
  IconCart,
  IconChat,
  IconSettings,
  IconSidebar,
  IconBell,
  IconLogout,
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
];

const SOON = [
  { label: "Buying & Selling", icon: <IconCart /> },
  { label: "Conversations", icon: <IconChat /> },
  { label: "Settings", icon: <IconSettings /> },
];

const SIDEBAR_KEY = "sidebar_open";

interface Props {
  title: string;
  titleIcon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, titleIcon, actions, children }: Props) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState<boolean>(() => {
    if (window.innerWidth <= 820) return false;
    return localStorage.getItem(SIDEBAR_KEY) !== "0";
  });

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

      <div className="app-main">
        <header className="app-top">
          <div className="app-title">{titleIcon}{title}</div>
          <div className="spacer" />
          <ThemeToggle />
          <button className="icon-btn" type="button" aria-label="Notifications"><IconBell /></button>
          {actions}
        </header>
        <div className="app-body">
          <div className="app-body-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
