/**
 * One HTML/CSS mock per journey stage (leads, personalize, pace, follow up,
 * learn). Static, clearly fictional sample content only; nothing here talks
 * to the API. The same sample people keep one consistent state everywhere:
 * Aisha and Daniel are being drafted in the hero (New / Queued), Wei Ling
 * clicked, Tomás opened and then replied.
 */

import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Download,
  Lock,
  MailCheck,
  MousePointerClick,
  Reply,
  Search,
  Send,
  Trophy,
  Upload,
} from 'lucide-react';
import { Chip, Panel, SampleTag } from './primitives';
import { PERSONAS, TAG_STYLE, serif, type Seg } from './tokens';

/* ---------------------------------------------------------------- 01 leads */

const LEAD_ROWS = [
  { n: 'Aisha Rahman', c: 'Kestrelway Freight', s: 'Logistics', o: 'Maya', am: 'Hana', st: 'New' },
  { n: 'Daniel Okafor', c: 'Quillmoor Dental', s: 'Healthcare', o: 'Maya', am: 'Priya', st: 'Queued' },
  { n: 'Wei Ling Tan', c: 'Vellora Labs', s: 'Biotech', o: 'Arif', am: 'Hana', st: 'Clicked' },
  { n: 'Tomás Reyes', c: 'Cobaltine Interiors', s: 'Retail', o: 'Arif', am: 'Priya', st: 'Replied' },
];

const LEAD_TOOLS = [
  { icon: Upload, label: 'Import' },
  { icon: Search, label: 'Scrape' },
  { icon: Download, label: 'CSV / Excel' },
];

const STATUS_STYLE: Record<string, string> = {
  New: 'bg-stone-100 text-stone-700',
  Queued: 'bg-brand-50 text-brand-800',
  Clicked: 'bg-violet-50 text-violet-800',
  Replied: 'bg-emerald-50 text-emerald-800',
};

export function LeadsVisual() {
  return (
    <Panel className="overflow-clip">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
        <span className="text-[13px] font-semibold text-stone-900">Leads</span>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
          Segment: Logistics + Healthcare
        </span>
        <SampleTag />
        <span className="ml-auto flex gap-1.5 text-[11px] font-semibold text-stone-700">
          {LEAD_TOOLS.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1">
              <Icon size={12} aria-hidden="true" /> {label}
            </span>
          ))}
        </span>
      </div>
      <table className="w-full text-left text-[12.5px]">
        <caption className="sr-only">Sample leads with segment, owner, account manager and status</caption>
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.14em] text-stone-600">
            <th scope="col" className="px-4 py-2.5 font-semibold">Lead</th>
            <th scope="col" className="hidden px-2 py-2.5 font-semibold sm:table-cell">Segment</th>
            <th scope="col" className="px-2 py-2.5 font-semibold">Owner</th>
            <th scope="col" className="hidden px-2 py-2.5 font-semibold sm:table-cell">Acct. mgr</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {LEAD_ROWS.map((r) => (
            <tr key={r.n} className="border-t border-stone-100">
              <td className="px-4 py-2.5">
                <p className="font-semibold text-stone-900">{r.n}</p>
                <p className="text-[11px] text-stone-600">{r.c}</p>
              </td>
              <td className="hidden px-2 py-2.5 text-stone-700 sm:table-cell">{r.s}</td>
              <td className="px-2 py-2.5 text-stone-700">{r.o}</td>
              <td className="hidden px-2 py-2.5 text-stone-700 sm:table-cell">{r.am}</td>
              <td className="px-4 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.st]}`}>{r.st}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* ---------------------------------------------------------- 02 personalise */

const DRAFTS: { initials: string; who: string; company: string; persona: string; subject: string; body: Seg[][] }[] = [
  {
    initials: 'WT',
    who: 'Wei Ling Tan',
    company: 'Vellora Labs',
    persona: 'Joel',
    subject: 'The first month in a new lab',
    body: [
      [
        { t: 'Congrats on ' },
        { t: 'the new sequencing lab', tag: 'lead' },
        { t: ' — the first month is usually all sample tracking and very little science.' },
      ],
      [{ t: 'Would a shared intake board take that off your plate?', tag: 'brief' }],
      [{ t: 'Joel', tag: 'persona' }],
    ],
  },
  {
    initials: 'TR',
    who: 'Tomás Reyes',
    company: 'Cobaltine Interiors',
    persona: 'Lena',
    subject: 'Your spring showroom',
    body: [
      [
        { t: 'Your ' },
        { t: 'spring showroom refresh', tag: 'lead' },
        { t: ' caught my eye, especially the way the reading nook is staged.' },
      ],
      [{ t: 'Do you track which pieces visitors ask about most?', tag: 'brief' }],
      [{ t: 'Lena', tag: 'persona' }],
    ],
  },
];

function DraftCard({ d }: { d: (typeof DRAFTS)[number] }) {
  return (
    <article className="flex flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <header className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-deep-600 text-[11px] font-bold text-white"
        >
          {d.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-stone-900">{d.who}</p>
          <p className="truncate text-[11px] text-stone-600">
            {d.company} · sent as {d.persona}
          </p>
        </div>
      </header>
      <p className="mt-3 text-[15px] font-semibold leading-snug text-stone-900" style={serif}>
        {d.subject}
      </p>
      <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-stone-700">
        {d.body.map((para, i) => (
          <p key={i}>
            {para.map((s, j) =>
              s.tag ? (
                <mark key={j} className={`rounded-[3px] px-0.5 ${TAG_STYLE[s.tag]}`}>
                  {s.t}
                </mark>
              ) : (
                <span key={j}>{s.t}</span>
              )
            )}
          </p>
        ))}
      </div>
    </article>
  );
}

export function PersonalizeVisual() {
  return (
    <div>
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-800">
            One brief <SampleTag />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {['Claude', 'Gemini', 'OpenAI', 'OpenAI-compatible'].map((p, i) => (
              <span
                key={p}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  i === 0 ? 'bg-gradient-to-r from-brand-600 to-brand-deep-600 text-white' : 'border border-stone-200 text-stone-600'
                }`}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[17px] leading-snug text-stone-900" style={serif}>
          <em>“Open with something specific to them. Keep it under 90 words. Ask one question.”</em>
        </p>
      </Panel>

      {/* the brief forks into one draft per lead */}
      <svg aria-hidden="true" className="mx-auto hidden h-8 w-1/2 sm:block" viewBox="0 0 100 32" preserveAspectRatio="none" fill="none">
        <path d="M50 0 V10 C50 20 0 14 0 32 M50 10 C50 20 100 14 100 32" stroke="rgb(var(--brand-300))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />
      </svg>
      <div className="mt-3 grid gap-3 sm:mt-0 sm:grid-cols-2">
        {DRAFTS.map((d) => (
          <DraftCard key={d.who} d={d} />
        ))}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 px-1 text-[12px] text-stone-700">
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-800">Variant A / B</span>
        Test two approaches inside one campaign.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- 03 pace */

// Positions are % of the 09:00-17:00 business window; three personas share
// one brand cap of 20 (6 + 8 + 6). Sam hits his limit and Joel takes over.
const SENDS: number[][] = [
  [3, 10, 18, 26, 33, 41],
  [7, 21, 37, 52, 68],
  [46, 55, 62, 71],
];
const NOW = 76;
const NEXT = 84;
const BRAND_CAP = 20;
const SENT = SENDS.flat().length;
// 08:00-18:00 axis: the business window spans 10%-90%.
const at = (x: number) => `${10 + x * 0.8}%`;
const HATCH = 'bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.08)_0_5px,transparent_5px_10px)]';

export function PaceVisual() {
  return (
    <div className="rounded-3xl bg-[#17171a] p-5 text-white shadow-[0_40px_80px_-40px_rgba(30,27,75,0.6)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] font-semibold">Today’s send plan · one brand, three personas</p>
        <SampleTag dark />
      </div>

      <div className="mt-9 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-5" aria-hidden="true">
        {/* lane labels */}
        <div className="space-y-1 py-2">
          {PERSONAS.map((p) => (
            <div key={p.name} className="flex h-9 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="truncate text-[12px] font-semibold text-stone-100">
                <span className="sm:hidden">{p.name.split(' ')[0]}</span>
                <span className="hidden sm:inline">
                  {p.name} <span className="font-normal text-stone-400">· {p.title}</span>
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* swimlanes */}
        <div className="relative">
          <div className={`absolute inset-y-0 left-0 w-[10%] rounded-l-lg ${HATCH}`} />
          <div className={`absolute inset-y-0 right-0 w-[10%] rounded-r-lg ${HATCH}`} />
          <div className="absolute inset-y-0 left-[10%] right-[10%] border-x border-white/15 bg-gradient-to-r from-violet-500/[0.08] via-brand-500/[0.08] to-sky-500/[0.08]" />
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${20 + i * 10}%` }} />
          ))}
          <div className="relative space-y-1 py-2">
            {PERSONAS.map((p, lane) => (
              <div key={p.name} className="relative h-9">
                <span className="absolute inset-x-[10%] top-1/2 h-px bg-white/10" />
                {SENDS[lane].map((x) => (
                  <span
                    key={x}
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-[#17171a]"
                    style={{ left: at(x), backgroundColor: p.color, boxShadow: `0 0 14px ${p.color}99` }}
                  />
                ))}
                {lane === 0 && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-100 ring-1 ring-violet-300/40"
                    style={{ left: `calc(${at(41)} + 12px)` }}
                  >
                    limit <span className="hidden sm:inline">→ Joel takes over</span>
                  </span>
                )}
                {lane === 2 && (
                  <span
                    className="lp-blink absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-sky-100 ring-1 ring-sky-300/50"
                    style={{ left: at(NEXT) }}
                  >
                    next
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="absolute -top-3 bottom-0 w-px bg-white" style={{ left: at(NOW) }}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-stone-900">
              now
            </span>
          </span>
        </div>

        {/* axis */}
        <span />
        <div className="relative mt-2 h-4 text-[10.5px] text-stone-400">
          {[
            ['09:00', 10],
            ['13:00', 50],
            ['17:00', 90],
          ].map(([t, l]) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${l}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[11.5px] text-stone-400">
        Hatched: outside business hours. Gaps between sends are randomized.
      </p>

      {/* cap + per-persona limits */}
      <div className="mt-6 grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-[1fr_1.1fr]">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] font-medium text-stone-300">Brand daily cap</p>
            <p className="text-[13px] font-semibold tabular-nums">
              {SENT}
              <span className="text-stone-400"> / {BRAND_CAP}</span>
            </p>
          </div>
          <div className="mt-2 grid grid-cols-10 gap-1" aria-hidden="true">
            {Array.from({ length: BRAND_CAP }).map((_, i) => (
              <span
                key={i}
                className={`h-3 rounded-sm ${i < SENT ? 'bg-gradient-to-t from-brand-500 to-violet-400' : 'bg-white/10'}`}
              />
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] leading-snug text-stone-400">
            Counted in the database, so a restart or a second worker can’t push past it.
          </p>
        </div>
        <ul className="space-y-2.5">
          {PERSONAS.map((p, i) => {
            const used = SENDS[i].length;
            const full = used >= p.cap;
            return (
              <li key={p.name}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="flex items-center gap-2 text-stone-200">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
                    {p.name}
                  </span>
                  <span className={`tabular-nums ${full ? 'font-semibold text-violet-200' : 'text-stone-400'}`}>
                    {used}/{p.cap}
                    {full ? ' · rotated' : ''}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-clip rounded-full bg-white/10" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${(used / p.cap) * 100}%`, backgroundColor: p.color }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 grid gap-2 border-t border-white/10 pt-5 text-[12px] text-stone-300 sm:grid-cols-3">
        <span className="inline-flex items-center gap-1.5">
          <MailCheck size={13} className="text-emerald-400" aria-hidden="true" /> MX checked before send
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Lock size={13} className="text-brand-300" aria-hidden="true" /> Single-run lock, no double sends
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck size={13} className="text-sky-300" aria-hidden="true" /> Gmail connected via OAuth
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 04 follow up */

// One schedule; the outcome pills are examples from three different leads.
const STEPS = [
  { d: 'Day 0', t: 'First email', s: 'Written from the brief', out: 'Sent to everyone in the batch', state: 'sent' },
  { d: '+2 days', t: 'Follow-up 1', s: 'New angle', out: 'Lead A opened: it goes out', state: 'sent' },
  { d: '+5 days', t: 'Follow-up 2', s: 'New angle', out: 'Lead B already clicked: skipped', state: 'skip' },
  { d: '+9 days', t: 'Follow-up 3', s: 'Last touch', out: 'Lead C replied earlier: never sends', state: 'stop' },
] as const;

const STEP_LOOK = {
  sent: { dot: 'from-brand-500 to-brand-deep-600', pill: 'bg-brand-50 text-brand-800', Icon: Send },
  skip: { dot: 'from-orange-500 to-amber-400', pill: 'bg-orange-50 text-orange-800', Icon: MousePointerClick },
  stop: { dot: 'from-emerald-500 to-teal-500', pill: 'bg-emerald-50 text-emerald-800', Icon: Reply },
};

export function FollowUpVisual() {
  return (
    <Panel className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-stone-900">Sequence · +2 / +5 / +9 days</p>
        <span className="text-[11px] text-stone-600">Outcomes shown for three example leads</span>
      </div>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute bottom-4 left-[15px] top-4 w-px bg-gradient-to-b from-brand-300 via-orange-300 to-emerald-300 sm:left-4 sm:right-4 sm:top-[15px] sm:bottom-auto sm:h-px sm:w-auto sm:bg-gradient-to-r"
        />
      <ol className="relative grid gap-5 sm:grid-cols-4 sm:gap-3">
        {STEPS.map((s, i) => {
          const look = STEP_LOOK[s.state];
          const Icon = i === 0 ? Check : look.Icon;
          return (
            <li key={s.d} className="relative flex gap-3 sm:block">
              <span
                aria-hidden="true"
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white ring-4 ring-white ${look.dot}`}
              >
                <Icon size={14} strokeWidth={2.5} />
              </span>
              <div className="sm:mt-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">{s.d}</p>
                <p className="text-[13.5px] font-semibold text-stone-900">{s.t}</p>
                <p className="text-[11.5px] text-stone-600">{s.s}</p>
                <p className={`mt-2 inline-block rounded-lg px-2 py-1 text-[11px] font-semibold leading-snug ${look.pill}`}>{s.out}</p>
              </div>
            </li>
          );
        })}
      </ol>
      </div>
      <div className="mt-6 hidden gap-2.5 border-t border-stone-100 pt-5 sm:grid sm:grid-cols-3">
        <div className="rounded-xl bg-brand-50 p-3">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-900">
            <MousePointerClick size={13} aria-hidden="true" /> Engagement gate
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-brand-900/85">Optional. When on, only people who opened or clicked get the next step.</p>
        </div>
        <div className="rounded-xl bg-orange-50 p-3">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-orange-950">
            <ArrowUpRight size={13} aria-hidden="true" /> Already clicked
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-orange-950/85">Optionally skipped, so interested people aren’t nagged.</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-900">
            <Reply size={13} aria-hidden="true" /> Replied or bounced
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-emerald-900/85">Replies are matched by thread; hard bounces are handled.</p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- 05 learn */

// Sample values for the shape of the report, not a performance claim.
const BARS = [
  { k: 'AI-written', v: 6.4, c: 'from-brand-500 via-brand-deep-500 to-violet-500' },
  { k: 'Template', v: 4.9, c: 'from-stone-300 to-stone-400' },
];
const BAR_MAX = 8;

const BEST = [
  { k: 'Best persona', v: 'Lena · Founder', pill: 'bg-orange-50 text-orange-800 ring-orange-200' },
  { k: 'Best subject line', v: '“Less phone tag at …”', pill: 'bg-amber-50 text-amber-900 ring-amber-200' },
  { k: 'Best segment', v: 'Healthcare', pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { k: 'Best owner / acct. mgr', v: 'Maya / Priya', pill: 'bg-sky-50 text-sky-800 ring-sky-200' },
];

export function LearnVisual() {
  return (
    <Panel className="overflow-clip">
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-stone-900">
          <Chip icon={Trophy} hue="sky" size="sm" />
          What’s Winning
        </p>
        <SampleTag />
      </div>
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600">
            AI vs template <span className="normal-case tracking-normal text-stone-500">· reply rate</span>
          </p>
          <div className="mt-3 space-y-3">
            {BARS.map((b) => (
              <div key={b.k}>
                <p className="flex items-baseline justify-between text-[12px] font-semibold text-stone-800">
                  {b.k}
                  <span className="tabular-nums text-stone-600">
                    {b.v.toFixed(1)}%<span className="sr-only"> reply rate (sample)</span>
                  </span>
                </p>
                <div className="mt-1 h-3 overflow-clip rounded-full bg-stone-100" aria-hidden="true">
                  <div className={`lp-bar h-3 origin-left rounded-full bg-gradient-to-r ${b.c}`} style={{ width: `${(b.v / BAR_MAX) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 to-violet-50 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-deep-700">AI recommendation</p>
            <p className="mt-1 text-[13px] leading-snug text-stone-800" style={serif}>
              <em>Shift the next healthcare batch to Lena’s persona and keep the short, question-style subject.</em>
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-1">
          {BEST.map((b) => (
            <div key={b.k}>
              <dt className="text-[11px] text-stone-600">{b.k}</dt>
              <dd className={`mt-1 inline-block max-w-full truncate rounded-lg px-2 py-1 text-[12.5px] font-semibold ring-1 ring-inset ${b.pill}`}>
                {b.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
