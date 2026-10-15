/**
 * Landing — public front door for UtilizeReach.
 *
 * Fully static: rendered outside App's config gate and makes no /api calls,
 * so it paints complete with the backend down. Whether the primary CTA reads
 * "Sign in" or "Open dashboard" is decided synchronously from the stored
 * token (no /api/auth/me round trip, so no CTA flash and no 401 redirect;
 * /dashboard's ProtectedRoute deals with a stale session).
 * Every product visual is HTML/CSS/SVG (src/components/landing/*). Motion is
 * CSS-driven and switched off under prefers-reduced-motion.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CalendarClock, Gauge, Github, PenLine, Terminal, Users, type LucideIcon } from 'lucide-react';
import { AUTH_TOKEN_EVENT, decodeTokenClaims, getStoredToken } from '../lib/auth';
import { Composer } from '../components/landing/Composer';
import { BrandsBand } from '../components/landing/BrandsBand';
import { Chip, Eyebrow, PrimaryCta, Reveal, Rise, SignalLines, SourceCta, Wordmark } from '../components/landing/primitives';
import { FollowUpVisual, LeadsVisual, LearnVisual, PaceVisual, PersonalizeVisual } from '../components/landing/StageVisuals';
import { FOCUS, HUES, INK, PAPER_HEX, REPO_URL, STOCK_PALETTE, serif, type Hue } from '../components/landing/tokens';

interface StageMeta {
  id: string;
  n: string;
  label: string;
  icon: LucideIcon;
  hue: Hue;
}

const STAGES: StageMeta[] = [
  { id: 'leads', n: '01', label: 'Leads', icon: Users, hue: 'blue' },
  { id: 'personalize', n: '02', label: 'Personalize', icon: PenLine, hue: 'violet' },
  { id: 'pace', n: '03', label: 'Pace', icon: Gauge, hue: 'orange' },
  { id: 'follow-up', n: '04', label: 'Follow up', icon: CalendarClock, hue: 'emerald' },
  { id: 'learn', n: '05', label: 'Learn', icon: BarChart3, hue: 'sky' },
];
const stage = (id: string) => STAGES.find((s) => s.id === id)!;

/* ------------------------------------------------------------- pieces */

/** Serif accent inside a heading. */
function Accent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-normal ${className}`} style={serif}>
      <em>{children}</em>
    </span>
  );
}

/** Gradient chip + big serif numeral + label: the header of every stage. */
function StageMark({ meta }: { meta: StageMeta }) {
  return (
    <div className="flex items-center gap-4">
      <span
        aria-hidden="true"
        className={`bg-gradient-to-br bg-clip-text pr-1 text-[48px] leading-none text-transparent sm:text-[68px] ${HUES[meta.hue]}`}
        style={serif}
      >
        {meta.n}
      </span>
      <Chip icon={meta.icon} hue={meta.hue} />
      <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-stone-600">{meta.label}</span>
    </div>
  );
}

function StageCopy({ meta, title, lede, points }: { meta: StageMeta; title: ReactNode; lede: string; points: string[] }) {
  return (
    <>
      <StageMark meta={meta} />
      <h2 id={`${meta.id}-title`} className={`mt-5 text-[30px] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[40px] ${INK}`}>
        {title}
      </h2>
      <p className="mt-4 max-w-[46ch] text-[15.5px] leading-relaxed text-stone-700">{lede}</p>
      <ul className="mt-6 hidden space-y-2.5 sm:block">
        {points.map((p) => (
          <li key={p} className="flex gap-3 text-[14px] leading-snug text-stone-800">
            <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br ${HUES[meta.hue]}`} aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
    </>
  );
}

function Stage({
  id,
  title,
  lede,
  points,
  visual,
  flip = false,
  ruled = true,
}: {
  id: string;
  title: ReactNode;
  lede: string;
  points: string[];
  visual: ReactNode;
  flip?: boolean;
  /** Drop the top rule when the stage directly follows a full-bleed band. */
  ruled?: boolean;
}) {
  const meta = stage(id);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-20 py-12 sm:py-20 ${ruled ? 'border-t border-stone-300/70' : ''}`}>
      <div className="grid gap-9 lg:grid-cols-12 lg:gap-14">
        <Reveal className={`lg:col-span-5 ${flip ? 'lg:order-2' : ''}`}>
          <StageCopy meta={meta} title={title} lede={lede} points={points} />
        </Reveal>
        <Reveal late className={`min-w-0 lg:col-span-7 lg:self-center ${flip ? 'lg:order-1' : ''}`}>
          {visual}
        </Reveal>
      </div>
    </section>
  );
}

/** The five stages as a compact, colour-coded index (hero, tablet and up). */
function JourneyRail() {
  return (
    <nav aria-label="The path of one email" className="rounded-2xl border border-stone-200 bg-white/70 p-4 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-600">The path of one email</p>
      <div className="relative mt-3">
        <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-5 h-px bg-gradient-to-r from-brand-300 via-orange-300 to-sky-300" />
      <ol className="relative grid grid-cols-5 gap-2">
        {STAGES.map((s) => (
          <li key={s.id} className="relative">
            <a href={`#${s.id}`} className={`group flex flex-col items-center gap-2 rounded-lg text-center ${FOCUS}`}>
              <span className="transition-transform group-hover:-translate-y-0.5">
                <Chip icon={s.icon} hue={s.hue} />
              </span>
              <span className="text-[11.5px] font-semibold leading-tight text-stone-800">
                <span className="block text-[10px] text-stone-600">{s.n}</span>
                {s.label}
              </span>
            </a>
          </li>
        ))}
      </ol>
      </div>
    </nav>
  );
}

/** A stored, well-formed, unexpired token. Local check only; never a security decision. */
function hasSession(): boolean {
  const claims = decodeTokenClaims(getStoredToken()) as { sub?: string; exp?: number } | null;
  if (!claims) return false;
  return typeof claims.exp !== 'number' || claims.exp * 1000 > Date.now();
}

function useHasSession() {
  const [signedIn, setSignedIn] = useState(hasSession);
  useEffect(() => {
    const sync = () => setSignedIn(hasSession());
    window.addEventListener(AUTH_TOKEN_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AUTH_TOKEN_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return signedIn;
}

/* --------------------------------------------------------------- page */

export default function Landing() {
  const signedIn = useHasSession();

  // Title, and a body colour that matches the page so overscroll shows no slab.
  useEffect(() => {
    const prevTitle = document.title;
    const prevBg = document.body.style.backgroundColor;
    document.title = 'UtilizeReach — AI cold outreach, written for one person at a time';
    document.body.style.backgroundColor = PAPER_HEX;
    return () => {
      document.title = prevTitle;
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

  return (
    <div className={`min-h-screen overflow-x-clip bg-[#f7f6f2] ${INK}`} style={STOCK_PALETTE}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* ------------------------------------------------ header */}
      <header className="sticky top-0 z-40 border-b border-stone-300/60 bg-[#f7f6f2]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-4 sm:px-8">
          <Link to="/" className={`rounded-md ${FOCUS}`} aria-label="UtilizeReach home">
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="ml-6 hidden items-center gap-6 text-[13px] font-semibold text-stone-600 lg:flex">
            {STAGES.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={`rounded py-2 transition-colors hover:text-stone-950 ${FOCUS}`}>
                {s.label}
              </a>
            ))}
            <a href="#self-host" className={`rounded py-2 transition-colors hover:text-stone-950 ${FOCUS}`}>
              Self-host
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden h-10 w-10 items-center justify-center rounded-full text-stone-700 transition-colors hover:bg-stone-200/60 sm:inline-flex ${FOCUS}`}
              aria-label="View source on GitHub (opens in a new tab)"
            >
              <Github size={18} aria-hidden="true" />
            </a>
            <PrimaryCta signedIn={signedIn} />
          </div>
        </div>
      </header>

      <main id="main">
        {/* ------------------------------------------------ hero */}
        <section aria-labelledby="hero-title" className="relative">
          {/* ruled paper + a faint brand wash */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[720px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
            style={{
              backgroundImage: 'linear-gradient(to right, rgba(120,113,108,0.12) 1px, transparent 1px)',
              backgroundSize: '80px 100%',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[radial-gradient(60%_50%_at_75%_10%,rgb(var(--brand-100)/0.7),transparent_70%)]"
          />
          <div className="relative mx-auto max-w-[1240px] px-4 pb-14 pt-10 sm:px-8 sm:pt-16 lg:pb-20">
            <Rise>
              <p className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/70 px-3 py-1 text-[11.5px] font-semibold text-stone-700">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-brand-500 to-brand-deep-600" aria-hidden="true" />
                Multi-brand AI outreach workspace
              </p>
              <h1
                id="hero-title"
                className="mt-6 text-[44px] font-extrabold leading-[1] tracking-[-0.035em] sm:text-[64px] lg:text-[80px] xl:text-[88px]"
              >
                Cold email, written for <br className="hidden lg:block" />
                <span
                  className="whitespace-nowrap bg-gradient-to-r from-brand-600 via-brand-deep-600 to-violet-600 bg-clip-text pr-2 font-normal tracking-[-0.02em] text-transparent"
                  style={serif}
                >
                  <em>one person</em>
                </span>{' '}
                <span className="whitespace-nowrap">at a time.</span>
              </h1>
            </Rise>

            <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-12">
              <Rise delay={0.12} className="lg:col-span-6">
                <p className="max-w-[54ch] text-[16.5px] leading-relaxed text-stone-700">
                  UtilizeReach writes a bespoke email for every lead from your campaign brief, paces sends across
                  rotating send-as personas, can save follow-ups for people who engaged, and shows you what’s winning.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <PrimaryCta signedIn={signedIn} size="lg" />
                  <SourceCta size="lg" />
                </div>
                <p className="mt-5 text-[12px] leading-relaxed text-stone-600">
                  Self-hostable with Docker Compose · Pluggable LLM · Source available
                </p>
              </Rise>
              <Rise delay={0.18} className="hidden sm:block lg:col-span-6">
                <JourneyRail />
              </Rise>
            </div>

            {/* the composer floats on a brand plate carrying the Login page's signal lines */}
            <Rise delay={0.24} className="relative mt-12 sm:mt-16">
              <div
                aria-hidden="true"
                className="absolute -inset-x-2 bottom-[-28px] top-24 overflow-clip rounded-[30px] bg-gradient-to-br from-brand-600 via-brand-700 to-brand-deep-800 sm:-inset-x-6"
              >
                <SignalLines id="hero" className="opacity-90" />
              </div>
              <div className="relative">
                <Composer />
              </div>
            </Rise>

            <Rise delay={0.3}>
              <p className="mt-12 text-center text-[12px] leading-relaxed text-stone-600">
                Illustrative preview. Every highlighted phrase traces back to an input:{' '}
                <span className="font-semibold text-brand-800">the lead</span>,{' '}
                <span className="font-semibold text-amber-800">the brief</span> or{' '}
                <span className="font-semibold text-brand-deep-800">the persona</span>.
              </p>
            </Rise>
          </div>
        </section>

        {/* ------------------------------------------------ stages */}
        <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <Stage
            id="leads"
            title={
              <>
                Start from a list <Accent>you can trust.</Accent>
              </>
            }
            lede="Bring leads in by import or scraping, group them into segments, and keep clear lines of ownership so credit lands where it belongs."
            points={[
              'Import lists or scrape new leads into the brand you’re working in',
              'Segments to target and report on the right slice',
              'Owner and account-manager attribution on every lead',
              'Export to CSV or Excel whenever you need it',
            ]}
            visual={<LeadsVisual />}
          />
          <Stage
            id="personalize"
            flip
            title={
              <>
                One brief. <Accent>A different email for every lead.</Accent>
              </>
            }
            lede="Write the brief once per campaign. The model writes each email for the person receiving it, and follow-ups rotate to fresh angles instead of repeating themselves."
            points={[
              'Pluggable LLM: Claude, Gemini, OpenAI or any OpenAI-compatible endpoint',
              'Follow-ups are AI-written too, each with a new angle',
              'A/B variants inside a campaign',
            ]}
            visual={<PersonalizeVisual />}
          />
        </div>

        {/* 03 breaks the rhythm: a full-bleed tinted band with a full-width chart */}
        <section
          id="pace"
          aria-labelledby="pace-title"
          className="scroll-mt-16 bg-gradient-to-br from-brand-50 via-[#f3f1fb] to-brand-deep-50"
        >
          <div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-8 sm:py-20">
            <Reveal className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-14">
              <div className="lg:col-span-6">
                <StageMark meta={stage('pace')} />
                <h2 id="pace-title" className="mt-5 text-[30px] font-bold leading-[1.08] tracking-[-0.02em] sm:text-[40px]">
                  Send like a person, <Accent>not a cannon.</Accent>
                </h2>
              </div>
              <div className="lg:col-span-6">
                <p className="text-[15.5px] leading-relaxed text-stone-700">
                  Deliverability comes first. Sends are spaced out, kept inside business hours and capped per day, with
                  send-as personas sharing the load. When one account hits its limit, the next one picks up.
                </p>
              </div>
            </Reveal>
            <Reveal late className="mt-10">
              <PaceVisual />
            </Reveal>
          </div>
        </section>

        <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <Stage
            id="follow-up"
            ruled={false}
            title={
              <>
                Follow up with <Accent>the people who engaged.</Accent>
              </>
            }
            lede="Sequences run on a schedule you set, like +2, +5 and +9 days. Turn on the engagement gate and only people who showed interest hear from you again."
            points={[
              'Optional gate: follow up only those who opened or clicked',
              'Skip anyone who already clicked through',
              'Replies detected by thread; hard bounces handled automatically',
            ]}
            visual={<FollowUpVisual />}
          />
          <Stage
            id="learn"
            flip
            title={
              <>
                See what’s winning, <Accent>then do more of it.</Accent>
              </>
            }
            lede="The What’s Winning report compares AI-written against template emails and surfaces your best persona, subject lines, segment, owner and account manager, with AI recommendations on what to try next."
            points={[
              'AI vs template, side by side',
              'Best persona, subject lines, segment, owner and account manager',
              'AI recommendations and campaign A/B variants',
            ]}
            visual={<LearnVisual />}
          />
        </div>

        <BrandsBand />

        {/* ------------------------------------------------ self-host + close */}
        <section id="self-host" aria-labelledby="selfhost-title" className="scroll-mt-20">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-12 lg:gap-16">
            <Reveal className="lg:col-span-5">
              <Eyebrow>Source available</Eyebrow>
              <h2 id="selfhost-title" className="mt-4 text-[32px] font-bold leading-[1.06] tracking-[-0.025em] sm:text-[44px]">
                Read the code. <Accent className="text-brand-700">Run it yourself.</Accent>
              </h2>
              <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-stone-700">
                The whole stack comes up with Docker Compose on infrastructure you control. Released under the PolyForm
                Noncommercial license: free to read, run and modify for noncommercial use.
              </p>
              <div className="mt-7">
                <SourceCta />
              </div>
            </Reveal>
            <Reveal late className="min-w-0 lg:col-span-7 lg:self-center">
              <div className="overflow-clip rounded-2xl bg-[#17171a] shadow-[0_40px_80px_-40px_rgba(30,27,75,0.6)]">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-[12px] text-stone-400">
                  <Terminal size={14} aria-hidden="true" />
                  Quick start
                </div>
                <pre className="whitespace-pre-wrap break-all px-4 py-5 text-[12px] leading-[1.8] text-stone-200 sm:whitespace-pre sm:break-normal sm:px-5 sm:text-[13px]">
                  <code>
                    <span className="text-stone-400">$ </span>git clone {REPO_URL}.git{'\n'}
                    <span className="text-stone-400">$ </span>cd utilizereach{'\n'}
                    <span className="text-stone-400"># fill in .env and backend/.env (see README){'\n'}</span>
                    <span className="text-stone-400">$ </span>
                    <span className="text-brand-300">docker compose up -d --build</span>
                  </code>
                </pre>
              </div>
            </Reveal>
          </div>

          <div className="mx-auto max-w-[1240px] px-4 pb-16 sm:px-8">
            <Reveal>
              <div className="relative overflow-clip rounded-[28px] bg-gradient-to-br from-brand-700 via-brand-700 to-brand-deep-800 px-6 py-12 text-white sm:px-14 sm:py-16">
                <SignalLines id="close" dots={false} className="opacity-70" />
                <div className="relative flex flex-col gap-8">
                  <div>
                    <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-white">
                      Paced, tracked, accounted for.
                    </p>
                    <h2 className="mt-3 text-[32px] font-bold leading-[1.05] tracking-[-0.025em] sm:text-[52px]">
                      Your next campaign <Accent>starts with a brief.</Accent>
                    </h2>
                    <p className="mt-3 max-w-[48ch] text-[15.5px] text-brand-50">
                      {signedIn
                        ? 'Your workspace is ready. Pick up where your team left off.'
                        : 'Sign in to your workspace to pick up where your team left off.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <PrimaryCta signedIn={signedIn} size="lg" onColor />
                    <SourceCta size="lg" dark />
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-300/70">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 py-8 text-[12.5px] text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Wordmark />
          <p>Source available under the PolyForm Noncommercial license.</p>
          <div className="-mx-2 flex items-center gap-3 font-semibold">
            <Link
              to={signedIn ? '/dashboard' : '/login'}
              className={`inline-flex min-h-[44px] items-center rounded px-2 hover:text-stone-950 ${FOCUS}`}
            >
              {signedIn ? 'Dashboard' : 'Sign in'}
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-[44px] items-center rounded px-2 hover:text-stone-950 ${FOCUS}`}
            >
              GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
