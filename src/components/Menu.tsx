import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface Props {
  /** Content of the trigger button (icon or label). */
  trigger: ReactNode;
  triggerClassName: string;
  triggerLabel: string;
  /** Horizontal edge of the trigger the menu aligns to. */
  align?: "start" | "end";
  /** Menu items; `close` dismisses the menu. */
  children: (close: () => void) => ReactNode;
}

const MARGIN = 8;
const GAP = 4;

/**
 * A dropdown menu anchored to its trigger with `position: fixed`, so it floats
 * above the page and is never clipped by an `overflow` container (e.g. the
 * horizontally-scrolling task table). It opens downward and flips upward when
 * there isn't enough room below.
 */
export function Menu({ trigger, triggerClassName, triggerLabel, align = "end", children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const b = btn.getBoundingClientRect();
    const m = menu.getBoundingClientRect();

    let left = align === "end" ? b.right - m.width : b.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - m.width - MARGIN));

    let top = b.bottom + GAP;
    if (top + m.height > window.innerHeight - MARGIN) {
      const above = b.top - m.height - GAP;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - m.height - MARGIN);
    }
    setPos({ top, left });
  }, [open, align]);

  // A fixed menu doesn't follow the trigger, so dismiss it if the page moves.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="menu-anchor">
      <button
        ref={btnRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              right: "auto",
              opacity: pos ? 1 : 0,
              transform: pos ? "none" : "translateY(-4px)",
              pointerEvents: pos ? "auto" : "none",
            }}
          >
            {children(close)}
          </div>
        </>
      )}
    </span>
  );
}
