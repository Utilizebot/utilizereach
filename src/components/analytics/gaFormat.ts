/** Small formatting helpers for the Google Analytics dashboard widgets. */

const numberFormat = new Intl.NumberFormat();

export function fmtNum(n: number): string {
  return numberFormat.format(Math.round(n));
}

/** Share of `part` in `whole` as a whole-number percentage (null when whole is 0). */
export function sharePct(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** GA engagement rate arrives as a 0..1 fraction; tolerate a 0..100 value too. */
export function engagementPct(rate: number): number {
  return Math.round(rate > 1 ? rate : rate * 100);
}

/** "jane_doe" -> "Jane Doe" (sender personas are slugged into utm_term). */
export function prettifyPersona(slug: string): string {
  if (!slug || slug.startsWith('(')) return slug;
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "q4_fintech_push" -> "q4 fintech push" (keeps the slug recognisable). */
export function prettifyCampaign(slug: string): string {
  if (!slug || slug.startsWith('(')) return slug;
  return slug.replace(/_+/g, ' ').trim();
}

/** Parse an ISO timestamp; a value without a zone is treated as UTC. */
export function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const ts = Date.parse(hasZone ? iso : `${iso}Z`);
  return Number.isFinite(ts) ? ts : null;
}

/** "just now" / "25s ago" / "3m ago" / "2h ago". */
export function agoText(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** "2026-11-20" -> "Nov 20" (no timezone shift). */
export function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** 83 -> "1m 23s", 7 -> "7s", 3725 -> "1h 2m". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m}m ${rest}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Percentage change from `previous` to `current` (null when there is no previous value). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Whole-number rate in percent, or null when the base is 0. */
export function ratePct(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}
