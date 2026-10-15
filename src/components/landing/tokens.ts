import type React from 'react';

/**
 * Shared tokens for the public landing page (src/pages/Landing.tsx).
 * Kept apart from the components so react-refresh stays happy.
 */

export const REPO_URL = 'https://github.com/Utilizebot/utilizereach';

/** Editorial serif for display accents (system fonts only, nothing fetched). */
export const serif = {
  fontFamily:
    "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, 'Noto Serif', serif",
} as const;

export const PAPER_HEX = '#f7f6f2';
export const INK = 'text-[#16161a]';

/**
 * The stock blue/indigo palette (the :root defaults in index.css). Set on the
 * landing root so a signed-in visitor's tenant brand theme, which ConfigContext
 * applies to <html>, never re-colours UtilizeReach's own marketing page.
 */
const STOCK_RGB: Record<string, string> = {
  '50': '239 246 255', '100': '219 234 254', '200': '191 219 254', '300': '147 197 253',
  '400': '96 165 250', '500': '59 130 246', '600': '37 99 235', '700': '29 78 216',
  '800': '30 64 175', '900': '30 58 138', '950': '23 37 84',
};
const STOCK_DEEP_RGB: Record<string, string> = {
  '50': '238 242 255', '100': '224 231 255', '200': '199 210 254', '300': '165 180 252',
  '400': '129 140 248', '500': '99 102 241', '600': '79 70 229', '700': '67 56 202',
  '800': '55 48 163', '900': '49 46 129', '950': '30 27 75',
};
export const STOCK_PALETTE = Object.fromEntries([
  ...Object.entries(STOCK_RGB).map(([k, v]) => [`--brand-${k}`, v]),
  ...Object.entries(STOCK_DEEP_RGB).map(([k, v]) => [`--brand-deep-${k}`, v]),
]) as React.CSSProperties;

export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f6f2]';

/** Gradient pairs echoing the dashboard's stat-card icon chips, one per journey stage. */
export const HUES = {
  blue: 'from-brand-500 to-brand-deep-600',
  violet: 'from-violet-500 to-fuchsia-500',
  orange: 'from-orange-500 to-amber-400',
  emerald: 'from-emerald-500 to-teal-500',
  sky: 'from-sky-500 to-brand-600',
} as const;
export type Hue = keyof typeof HUES;

/** Send-as persona colours (pacing lanes, persona chips). */
export const PERSONAS = [
  { name: 'Sam Lee', title: 'Partnerships', color: '#8b5cf6', cap: 6 },
  { name: 'Lena Ortiz', title: 'Founder', color: '#f97316', cap: 8 },
  { name: 'Joel Park', title: 'Sales', color: '#0ea5e9', cap: 6 },
] as const;

/** Provenance colours: every personalised phrase traces back to one of these inputs. */
export type Tag = 'lead' | 'brief' | 'persona';
export type Seg = { t: string; tag?: Tag };

export const TAG_STYLE: Record<Tag, string> = {
  lead: 'bg-brand-100/80 text-brand-900 shadow-[inset_0_-2px_0_rgb(var(--brand-400))]',
  brief: 'bg-amber-100 text-amber-950 shadow-[inset_0_-2px_0_#f59e0b]',
  persona: 'bg-brand-deep-100 text-brand-deep-900 shadow-[inset_0_-2px_0_rgb(var(--brand-deep-400))]',
};

export const TAG_DOT: Record<Tag, string> = {
  lead: 'bg-brand-500',
  brief: 'bg-amber-500',
  persona: 'bg-brand-deep-500',
};

