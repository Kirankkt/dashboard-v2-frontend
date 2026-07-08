import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

type Theme = "light" | "dark";
const KEY = "theme";

function stored(): Theme | null {
  const s = localStorage.getItem(KEY);
  return s === "light" || s === "dark" ? s : null;
}
function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(stored);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  const isDark = theme ? theme === "dark" : systemDark();

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    localStorage.setItem(KEY, next);
    setTheme(next);
  }

  return (
    <button className="icon-btn" type="button" onClick={toggle} aria-label="Toggle light or dark theme">
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
