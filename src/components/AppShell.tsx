import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { Menu } from "./Menu";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconTasks,
  IconGrid,
  IconChart,
  IconCrew,
  IconSettings,
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

interface Props {
  title: string;
  titleIcon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, titleIcon, actions, children }: Props) {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="rail-logo" aria-hidden="true">R</div>
        <button className="rail-btn active" type="button" aria-label="Tasks" aria-current="page"><IconTasks /></button>
        <button className="rail-btn" type="button" aria-label="Grid — coming soon" title="Grid — coming soon"><IconGrid /></button>
        <button className="rail-btn" type="button" aria-label="Summary — coming soon" title="Summary — coming soon"><IconChart /></button>
        <button className="rail-btn" type="button" aria-label="Crew — coming soon" title="Crew — coming soon"><IconCrew /></button>
        <button className="rail-btn" type="button" aria-label="Settings — coming soon" title="Settings — coming soon"><IconSettings /></button>
        <div className="rail-spacer" />
        <Menu
          trigger={initials(user?.name)}
          triggerClassName="rail-avatar"
          triggerLabel="Account menu"
          align="start"
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
