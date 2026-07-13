// Shared date helpers. All "iso" values are local-calendar YYYY-MM-DD strings.

export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return isoOf(new Date());
}

export function dateOf(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function addDaysISO(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** "13 Jul" */
export function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  return dateOf(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** "Mon, 13 Jul" */
export function fmtDay(iso: string): string {
  return dateOf(iso).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

/** "July 2026" */
export function fmtMonth(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
