/**
 * Dark band (the Login page's ink + signal lines): multi-brand isolation,
 * then compliance, tracking and self-hosting as small product fragments.
 */

import type { ReactNode } from 'react';
import { Ban, Database, Layers, Lock, MailOpen, MousePointerClick, Reply, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Eyebrow, Reveal, SampleTag, SignalLines } from './primitives';
import { serif } from './tokens';

const BRANDS = [
  { name: 'Larkspur Logistics', color: '#2563eb', active: true },
  { name: 'Tidewell Health', color: '#0d9488', active: false },
  { name: 'Atelier Ombra', color: '#db2777', active: false },
];
const OWNS = ['Mailbox', 'Personas', 'AI settings', 'Leads', 'Campaigns', 'Theme colors'];
const ROLES = ['Admin', 'Manager', 'Member', 'Viewer'];

// `note` carries its own colour: no opacity tricks on the gradient row (AA).
const LAYERS: { icon: LucideIcon; title: string; note: string; look: string; noteLook: string }[] = [
  {
    icon: Layers,
    title: 'App-layer brand scoping',
    note: 'Every request runs inside the active brand',
    look: 'bg-white/[0.06] text-stone-100 ring-1 ring-inset ring-white/10',
    noteLook: 'text-stone-300',
  },
  {
    icon: Database,
    title: 'Postgres row-level security',
    note: 'A second wall, enforced by the database',
    look: 'bg-gradient-to-r from-brand-700 to-brand-deep-700 text-white',
    noteLook: 'text-white',
  },
  {
    icon: ShieldCheck,
    title: 'Global suppression list',
    note: 'Applies across every brand',
    look: 'bg-white text-stone-900',
    noteLook: 'text-stone-600',
  },
];

function BrandSwitcher() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1f1f23] p-4 sm:p-5">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">Switch brand</p>
        <SampleTag dark />
      </div>
      <ul className="mt-3 space-y-1.5">
        {BRANDS.map((b) => (
          <li
            key={b.name}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${b.active ? 'bg-white text-stone-900' : 'text-stone-200'}`}
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${b.color}, ${b.color}bb)` }}
            >
              {b.name[0]}
            </span>
            <span className="min-w-0 truncate text-[13.5px] font-semibold">{b.name}</span>
            {b.active && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-stone-600">
                <Lock size={11} aria-hidden="true" /> Active
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-white/10 px-1 pt-4">
        <p className="text-[11px] text-stone-400">Each brand has its own</p>
        <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {OWNS.map((o) => (
            <li key={o} className="flex items-center gap-2 text-[13px] text-stone-200">
              <span className="h-1 w-3 rounded-full bg-gradient-to-r from-brand-400 to-brand-deep-400" aria-hidden="true" />
              {o}
            </li>
          ))}
        </ul>
      </div>
      <ul className="mt-5 space-y-2" aria-label="Isolation layers">
        {LAYERS.map(({ icon: Icon, title, note, look, noteLook }) => (
          <li key={title} className={`flex flex-col gap-0.5 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${look}`}>
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Icon size={14} aria-hidden="true" /> {title}
            </span>
            <span className={`text-[12px] ${noteLook}`}>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function Fragment({ n, title, text, children }: { n: string; title: string; text: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[13px] text-brand-300" style={serif}>
        <em>{n}</em>
      </p>
      <h3 className="mt-1.5 text-[18px] font-bold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-stone-300">{text}</p>
      <div className="mt-4 rounded-xl border border-white/10 bg-[#1f1f23] p-3">{children}</div>
    </div>
  );
}

const SUPPRESSED = [
  { v: 'competitor.example', scope: 'Brand' },
  { v: 'existing-customers list', scope: 'Brand' },
  { v: 'do-not-contact address', scope: 'Global' },
];

function SuppressionFragment() {
  return (
    <>
      <div className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2.5 py-2">
        <span className="text-[12px] text-stone-200">Unsubscribe link on every email</span>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-200">one click</span>
      </div>
      <ul className="mt-1.5 divide-y divide-white/[0.06]">
        {SUPPRESSED.map((r) => (
          <li key={r.v} className="flex items-center justify-between gap-2 px-1 py-2">
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-stone-300">
              <Ban size={12} className="shrink-0 text-stone-400" aria-hidden="true" />
              <span className="truncate">{r.v}</span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${
                r.scope === 'Brand' ? 'bg-brand-500/15 text-brand-200 ring-brand-400/30' : 'bg-rose-500/15 text-rose-200 ring-rose-400/30'
              }`}
            >
              {r.scope}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const EVENTS: { icon: LucideIcon; label: string; who: string; tone: string }[] = [
  { icon: MailOpen, label: 'Opened', who: 'Tomás R.', tone: 'text-sky-300' },
  { icon: MousePointerClick, label: 'Clicked · UTM tagged', who: 'Wei Ling T.', tone: 'text-violet-300' },
  { icon: Reply, label: 'Replied (thread match)', who: 'Tomás R.', tone: 'text-emerald-300' },
  { icon: Ban, label: 'Hard bounce, stopped', who: 'old domain', tone: 'text-rose-300' },
];

function TrackingFragment() {
  return (
    <ul className="space-y-1.5">
      {EVENTS.map(({ icon: Icon, label, who, tone }) => (
        <li key={label} className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2">
          <Icon size={14} className={`shrink-0 ${tone}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-stone-200">{label}</span>
          <span className="shrink-0 text-[11px] text-stone-400">{who}</span>
        </li>
      ))}
    </ul>
  );
}

function RunFragment() {
  const rows = [
    { k: 'Deploy', v: ['Docker Compose'] },
    { k: 'Model', v: ['Claude', 'Gemini', 'OpenAI', 'OpenAI-compatible'] },
    { k: 'Mailbox', v: ['Gmail OAuth'] },
  ];
  return (
    <dl className="space-y-2.5 px-1 py-1">
      {rows.map((r) => (
        <div key={r.k}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-stone-400">{r.k}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {r.v.map((v) => (
              <span key={v} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[12px] font-medium text-stone-100 ring-1 ring-inset ring-white/10">
                {v}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ band */

export function BrandsBand() {
  return (
    <section aria-labelledby="brands-title" className="relative overflow-clip bg-[#17171a] text-white">
      {/* signal lines run beside the copy on desktop (faded out under it); phones skip them */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[640px] [mask-image:linear-gradient(to_right,transparent_30%,black_70%)] lg:block">
        <SignalLines id="brands" />
      </div>
      <div className="relative mx-auto max-w-[1240px] px-4 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-6">
            <Eyebrow dark>Multi-brand workspaces</Eyebrow>
            <h2 id="brands-title" className="mt-4 text-[34px] font-bold leading-[1.05] tracking-[-0.025em] sm:text-[50px]">
              Many brands, one deployment.{' '}
              <span className="font-normal text-brand-300" style={serif}>
                <em>Walled off twice.</em>
              </span>
            </h2>
            <p className="mt-5 max-w-[50ch] text-[15.5px] leading-relaxed text-stone-300">
              Run every product or client brand from the same install. Each one is scoped in the app layer, and
              again by Postgres row-level security underneath it.
            </p>
            <div className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Per-brand roles</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <li key={r} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12.5px] font-semibold text-stone-100">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal late className="lg:col-span-6">
            <BrandSwitcher />
          </Reveal>
        </div>

        <div className="mt-14 grid gap-10 border-t border-white/10 pt-12 md:grid-cols-3 md:gap-8">
          <Reveal>
            <Fragment
              n="i."
              title="Compliance built in"
              text="One-click unsubscribe, exclusion lists per brand, and a global suppression list that holds across all of them."
            >
              <SuppressionFragment />
            </Fragment>
          </Reveal>
          <Reveal late>
            <Fragment
              n="ii."
              title="Tracking that closes the loop"
              text="Opens and clicks with UTM tagging, replies matched by thread, hard bounces handled."
            >
              <TrackingFragment />
            </Fragment>
          </Reveal>
          <Reveal late>
            <Fragment n="iii." title="Yours to run" text="Self-hostable on your own infrastructure, and the model is pluggable.">
              <RunFragment />
            </Fragment>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
