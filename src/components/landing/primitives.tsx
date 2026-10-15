/**
 * Small building blocks for the landing page: reveals, wordmark, CTAs,
 * gradient chips and the Login page's signal-line motif.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, Github, type LucideIcon } from 'lucide-react';
import { FOCUS, HUES, INK, REPO_URL, type Hue } from './tokens';

/** Scroll-driven reveal (CSS only; see the "landing" block in index.css). */
export function Reveal({ children, late = false, className = '' }: { children: ReactNode; late?: boolean; className?: string }) {
  return <div className={`lp-reveal ${late ? 'lp-reveal-late' : ''} ${className}`}>{children}</div>;
}

/** Above-the-fold load-in (time based, staggered). */
export function Rise({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`lp-load ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-deep-600 shadow-sm shadow-brand-600/30"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
          <path d="M3 13c3 0 4-6 7-6s4 6 7 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <circle cx="17" cy="13" r="1.6" fill="white" />
        </svg>
      </span>
      <span className="leading-none">
        <span className={`block text-[15px] font-bold tracking-tight ${dark ? 'text-white' : INK}`}>UtilizeReach</span>
        <span
          className={`mt-0.5 block text-[9.5px] font-semibold uppercase tracking-[0.2em] ${
            dark ? 'text-stone-400' : 'text-stone-600'
          }`}
        >
          by UtilizeBot
        </span>
      </span>
    </span>
  );
}

/** "Sign in" for visitors, "Open dashboard" when a session already exists. */
export function PrimaryCta({
  signedIn,
  size = 'md',
  onColor = false,
}: {
  signedIn: boolean;
  size?: 'md' | 'lg';
  onColor?: boolean;
}) {
  const pad = size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-sm';
  const look = onColor
    ? 'bg-white text-brand-800 shadow-lg hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700'
    : `bg-gradient-to-r from-brand-600 to-brand-deep-600 text-white shadow-lg shadow-brand-600/25 hover:from-brand-700 hover:to-brand-deep-700 hover:shadow-xl hover:shadow-brand-600/30 ${FOCUS}`;
  return (
    <Link
      to={signedIn ? '/dashboard' : '/login'}
      className={`group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all ${pad} ${look}`}
    >
      {signedIn ? 'Open dashboard' : 'Sign in'}
      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

export function SourceCta({ dark = false, size = 'md' }: { dark?: boolean; size?: 'md' | 'lg' }) {
  const pad = size === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-10 px-4 text-sm';
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition-colors ${pad} ${
        dark
          ? 'border-white/25 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'
          : `border-stone-300 bg-white/70 ${INK} hover:border-stone-400 hover:bg-white ${FOCUS}`
      }`}
    >
      <Github size={16} aria-hidden="true" />
      View source on GitHub
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-stone-200/90 bg-white shadow-[0_1px_0_rgba(22,22,26,0.04),0_24px_48px_-28px_rgba(30,27,75,0.25)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${dark ? 'text-brand-300' : 'text-brand-700'}`}>
      {children}
    </p>
  );
}

/** Gradient icon chip, the same visual unit the dashboard uses on its stat cards. */
export function Chip({ icon: Icon, hue, size = 'md' }: { icon: LucideIcon; hue: Hue; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-xl';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-md shadow-stone-900/10 ${box} ${HUES[hue]}`}
    >
      <Icon size={size === 'sm' ? 14 : 18} strokeWidth={2.2} />
    </span>
  );
}

export function SampleTag({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        dark ? 'bg-white/10 text-stone-300' : 'bg-stone-100 text-stone-600'
      }`}
    >
      Sample data
    </span>
  );
}

/**
 * The Login page's signal lines, with glowing pulses travelling along them
 * a few times and then resting (skipped under prefers-reduced-motion).
 */
const SIGNAL_PATHS = [
  'M-40 520 C 260 500, 380 330, 700 340 S 1160 470, 1480 300',
  'M-40 600 C 300 590, 460 420, 760 430 S 1200 560, 1480 420',
  'M-40 440 C 220 420, 480 260, 780 270 S 1240 330, 1480 190',
];

export function SignalLines({ id, className = '', dots = true }: { id: string; className?: string; dots?: boolean }) {
  const reduce = useReducedMotion();
  const strokes = ['rgb(var(--brand-400))', 'rgb(var(--brand-deep-400))', 'rgb(var(--brand-300))'];
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 1440 700"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-dot`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.4" stopColor="rgb(var(--brand-300))" />
          <stop offset="1" stopColor="rgb(var(--brand-500))" stopOpacity="0" />
        </radialGradient>
      </defs>
      {SIGNAL_PATHS.map((d, i) => (
        <path
          key={d}
          d={d}
          // the shared .login-signal dash (1200) was sized for the Login paths;
          // normalising the length makes it cover these longer ones fully
          pathLength={1200}
          className={`login-signal ${i ? `login-signal-${i + 1}` : ''}`}
          style={{ stroke: strokes[i] }}
          strokeOpacity={[0.55, 0.38, 0.2][i]}
          strokeWidth="1.5"
        />
      ))}
      {dots &&
        !reduce &&
        SIGNAL_PATHS.map((d, i) => (
          <circle key={`dot-${d}`} r={i === 0 ? 6 : 4} fill={`url(#${id}-dot)`} opacity="0">
            <animate attributeName="opacity" values="0;1;1;0" dur={`${8 + i * 2}s`} begin={`${2.4 + i * 1.3}s`} repeatCount="3" />
            <animateMotion dur={`${8 + i * 2}s`} begin={`${2.4 + i * 1.3}s`} repeatCount="3" path={d} />
          </circle>
        ))}
    </svg>
  );
}
