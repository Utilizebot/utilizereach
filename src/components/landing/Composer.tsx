/**
 * Hero product visual: an AI email being written for one lead, with every
 * personalized phrase colour-coded back to its source (lead, brief, persona).
 *
 * Motion budget: the draft streams in word by word and the preview steps
 * through the demo leads once, then rests. It pauses while off-screen, while
 * the tab is hidden and while the pointer or focus is inside it, and the
 * visible "Pause" toggle stops it outright (WCAG 2.2.2). Under reduced motion
 * the full email renders at once and nothing auto-advances. Assistive tech
 * always gets the complete email as static text, never the partial stream.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Ban, MailCheck, Pause, Play, Sparkles } from 'lucide-react';
import { FOCUS, TAG_DOT, TAG_STYLE, serif, type Seg, type Tag } from './tokens';

interface DemoLead {
  id: string;
  initials: string;
  name: string;
  role: string;
  company: string;
  segment: string;
  note: string;
  campaign: string;
  persona: { name: string; title: string; sent: number; limit: number };
  brief: string;
  subject: string;
  body: Seg[][];
  slot: string;
}

const LEADS: DemoLead[] = [
  {
    id: 'aisha',
    initials: 'AR',
    name: 'Aisha Rahman',
    role: 'Head of Operations',
    company: 'Kestrelway Freight',
    segment: 'Logistics',
    note: 'Expanding cold-chain fleet',
    campaign: 'Route planning, Q4',
    persona: { name: 'Sam Lee', title: 'Partnerships', sent: 5, limit: 6 },
    brief: 'Open with their operational pain. One question. Under 90 words.',
    subject: 'Cold-chain growth without the dispatch scramble',
    body: [
      [{ t: 'Hi Aisha,', tag: 'lead' }],
      [
        { t: 'Saw that ' },
        { t: 'Kestrelway is expanding its cold-chain fleet', tag: 'lead' },
        { t: ' — usually the moment dispatch turns into a spreadsheet and a lot of phone calls.' },
      ],
      [
        { t: 'We help ' },
        { t: 'operations teams', tag: 'lead' },
        { t: ' plan temperature-sensitive routes in one place, so a new truck adds capacity, not chaos.' },
      ],
      [{ t: 'Worth a 15-minute look next week?', tag: 'brief' }],
      [{ t: 'Sam', tag: 'persona' }],
    ],
    slot: 'Tue 10:42',
  },
  {
    id: 'daniel',
    initials: 'DO',
    name: 'Daniel Okafor',
    role: 'Clinic Director',
    company: 'Quillmoor Dental',
    segment: 'Healthcare',
    note: 'Bookings by phone only',
    campaign: 'Clinic booking, Q4',
    persona: { name: 'Lena Ortiz', title: 'Founder', sent: 4, limit: 8 },
    brief: 'We offer online booking and reminders for dental clinics. Warm and brief. One concrete win. Soft ask.',
    subject: 'Less phone tag at Quillmoor',
    body: [
      [{ t: 'Hi Daniel,', tag: 'lead' }],
      [
        { t: 'Noticed ' },
        { t: 'Quillmoor still takes bookings by phone', tag: 'lead' },
        { t: ' — for a busy clinic that often means the front desk is on hold instead of with patients.' },
      ],
      [
        { t: 'We put ' },
        { t: 'online booking and reminders', tag: 'brief' },
        { t: ' on autopilot for dental practices, without changing how your team works.' },
      ],
      [{ t: 'Open to seeing how it would look for your clinic?', tag: 'brief' }],
      [{ t: 'Lena', tag: 'persona' }],
    ],
    slot: 'Wed 14:07',
  },
];

const wordsOf = (s: string) => s.match(/\s*\S+\s*/g) ?? [];

/**
 * Reveal the draft word by word. `still` shows it complete at once (reduced
 * motion or paused by the visitor); `hold` freezes it where it is (off-screen,
 * hidden tab). Progress is keyed to the lead, so switching restarts cleanly.
 */
function useStreamingWords(lead: DemoLead, still: boolean, hold: boolean) {
  const total = useMemo(() => lead.body.flat().reduce((n, s) => n + wordsOf(s.t).length, 0), [lead]);
  const [progress, setProgress] = useState({ id: lead.id, n: 0 });
  const streamed = progress.id === lead.id ? progress.n : 0;
  const shown = still ? total : streamed;
  const finished = shown >= total;

  useEffect(() => {
    if (still || hold || finished) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const n = (p.id === lead.id ? p.n : 0) + 1;
        if (n >= total) window.clearInterval(id);
        return { id: lead.id, n: Math.min(n, total) };
      });
    }, 42);
    return () => window.clearInterval(id);
  }, [lead.id, total, still, hold, finished]);

  return { shown, done: finished };
}

/** True while the element is at least partly on screen and the tab is visible. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const el = ref.current;
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | undefined;
    if (el && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
      io.observe(el);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, []);
  return { ref, active: inView && visible };
}

function StreamedBody({ lead, shown, done }: { lead: DemoLead; shown: number; done: boolean }) {
  let offset = 0;
  return (
    <div className="space-y-3 text-[14px] leading-[1.7] text-stone-800">
      {lead.body.map((para, pi) => {
        const before = offset;
        const parts = para.map((seg, si) => {
          const words = wordsOf(seg.t);
          const start = offset;
          offset += words.length;
          const k = Math.max(0, Math.min(words.length, shown - start));
          if (k === 0) return null;
          const text = words.slice(0, k).join('');
          return seg.tag ? (
            <mark key={si} className={`rounded-[3px] px-0.5 ${TAG_STYLE[seg.tag]}`}>
              {text}
            </mark>
          ) : (
            <span key={si}>{text}</span>
          );
        });
        if (shown <= before) return null;
        const writing = !done && shown <= offset;
        return (
          <p key={pi}>
            {parts}
            {writing && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-brand-600"
              />
            )}
          </p>
        );
      })}
    </div>
  );
}

/** The complete email as plain text for assistive tech (the visual stream is aria-hidden). */
function StaticEmail({ lead }: { lead: DemoLead }) {
  return (
    <div className="sr-only">
      <p>
        Draft for {lead.name}, {lead.role} at {lead.company}. Subject: {lead.subject}
      </p>
      {lead.body.map((para, pi) => (
        <p key={pi}>
          {para.map((seg, si) =>
            seg.tag ? (
              <mark key={si}>
                {seg.t} <span>(from the {seg.tag})</span>
              </mark>
            ) : (
              <span key={si}>{seg.t}</span>
            )
          )}
        </p>
      ))}
    </div>
  );
}

function InputCard({ tag, label, children, aside }: { tag: Tag; label: string; children: ReactNode; aside?: ReactNode }) {
  const tone = { lead: 'text-brand-700', brief: 'text-amber-800', persona: 'text-brand-deep-700' }[tag];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${TAG_DOT[tag]}`} aria-hidden="true" /> {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function LeadSwitch({ idx, onPick, mobile = false }: { idx: number; onPick: (i: number) => void; mobile?: boolean }) {
  return (
    <>
      {LEADS.map((l, i) => (
        <button
          key={l.id}
          type="button"
          aria-pressed={i === idx}
          onClick={() => onPick(i)}
          className={`rounded-full font-semibold transition-colors ${FOCUS} ${
            mobile ? 'px-3 py-1.5 text-[12px]' : 'px-2.5 py-1 text-[11px]'
          } ${i === idx ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200' : 'text-stone-600 hover:text-stone-900'}`}
        >
          {mobile ? `Write for ${l.name.split(' ')[0]}` : l.name.split(' ')[0]}
        </button>
      ))}
    </>
  );
}

export function Composer() {
  const reduce = !!useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false); // pointer or focus inside
  const [steps, setSteps] = useState(0);
  const { ref, active } = useOnScreen<HTMLDivElement>();
  const lead = LEADS[idx];
  const { shown, done } = useStreamingWords(lead, reduce || paused, !active);

  // Step through the demo leads once (back to the first), then rest. Stops for
  // good when the visitor picks a lead or presses Pause.
  const cycling = auto && !paused && !reduce && steps < LEADS.length;
  useEffect(() => {
    if (!cycling || !done || !active || engaged) return;
    const t = window.setTimeout(() => {
      setIdx((i) => (i + 1) % LEADS.length);
      setSteps((n) => n + 1);
    }, 5200);
    return () => window.clearTimeout(t);
  }, [cycling, done, active, engaged, idx]);

  const pick = (i: number) => {
    setAuto(false);
    setIdx(i);
  };

  return (
    <div
      ref={ref}
      className="relative overflow-clip rounded-[22px] border border-white/60 bg-white shadow-[0_2px_0_rgba(22,22,26,0.04),0_60px_120px_-40px_rgba(30,27,75,0.55)]"
      role="group"
      aria-label="Product preview: a lead, a campaign brief and a send-as persona combine into a personalized email draft"
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEngaged(false);
      }}
    >
      {/* window bar */}
      <div className="flex items-center gap-3 border-b border-stone-200 bg-stone-50/80 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <p className="min-w-0 truncate text-[12px] text-stone-600">
          <span className="font-semibold text-stone-800">Campaigns</span>
          <span className="mx-1.5 text-stone-400" aria-hidden="true">/</span>
          {lead.campaign}
          <span className="mx-1.5 text-stone-400" aria-hidden="true">/</span>
          Draft
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-1 sm:flex" role="group" aria-label="Preview lead">
            <LeadSwitch idx={idx} onPick={pick} />
          </div>
          {!reduce && (
            <button
              type="button"
              aria-pressed={paused}
              aria-label="Pause preview animation"
              onClick={() => setPaused((p) => !p)}
              className={`ml-1 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-white hover:text-stone-900 ${FOCUS}`}
            >
              {paused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}
              <span aria-hidden="true">{paused ? 'Play' : 'Pause'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)_250px]">
        {/* inputs */}
        <div className="space-y-3 border-b border-stone-200 bg-[#fbfaf7] p-4 lg:border-b-0 lg:border-r">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-600">Inputs</p>

          <div key={lead.id} className="lp-swap-slide">
            <InputCard
              tag="lead"
              label="Lead"
              aside={
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                  <MailCheck size={11} aria-hidden="true" /> MX verified
                </span>
              }
            >
              <div className="mt-2.5 flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-deep-600 text-[12px] font-bold text-white"
                >
                  {lead.initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-stone-900">{lead.name}</p>
                  <p className="truncate text-[11.5px] text-stone-600">{lead.role}</p>
                  <p className="truncate text-[11.5px] font-medium text-stone-700">{lead.company}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10.5px] font-medium text-stone-700">
                  {lead.segment}
                </span>
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-medium text-brand-800">{lead.note}</span>
              </div>
            </InputCard>
          </div>

          <InputCard tag="persona" label="Send as">
            <p className="mt-2 truncate text-[13px] font-semibold text-stone-900">
              {lead.persona.name}
              <span className="font-normal text-stone-600"> · {lead.persona.title}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-clip rounded-full bg-stone-100" aria-hidden="true">
              <motion.div
                className="h-full w-full origin-left rounded-full bg-gradient-to-r from-brand-deep-400 to-brand-deep-600"
                initial={false}
                animate={{ scaleX: lead.persona.sent / lead.persona.limit }}
                transition={{ duration: reduce ? 0 : 0.6 }}
              />
            </div>
            <p className="mt-1.5 text-[10.5px] text-stone-600">
              {lead.persona.sent} of {lead.persona.limit} today on this account
            </p>
          </InputCard>

          <InputCard tag="brief" label="Campaign brief">
            <p className="mt-2 text-[12.5px] leading-snug text-stone-700" style={serif}>
              <em>“{lead.brief}”</em>
            </p>
          </InputCard>
        </div>

        {/* draft */}
        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-brand-deep-600 px-2.5 py-1 text-[11px] font-semibold text-white">
              <Sparkles size={12} aria-hidden="true" />
              {done ? 'Draft ready' : 'Writing…'}
            </span>
            <span className="text-[11px] text-stone-600">
              Model: <span className="font-semibold text-stone-800">Claude</span>
              <span className="hidden sm:inline"> · or Gemini, OpenAI, any compatible endpoint</span>
            </span>
          </div>

          <StaticEmail lead={lead} />
          <div className="mt-5 border-b border-stone-200 pb-4" aria-hidden="true">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-600">Subject</p>
            <p
              key={lead.id}
              className="lp-swap-fade mt-1 text-[19px] font-semibold leading-snug tracking-tight text-stone-900 sm:text-[21px]"
              style={serif}
            >
              {lead.subject}
            </p>
          </div>

          <div className="mt-4 min-h-[262px] sm:min-h-[236px]" aria-hidden="true">
            <StreamedBody lead={lead} shown={shown} done={done} />
          </div>

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-dashed border-stone-200 pt-4 text-[11px] text-stone-600">
            {(['lead', 'brief', 'persona'] as Tag[]).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-sm ${TAG_DOT[t]}`} aria-hidden="true" />
                from the {t}
              </span>
            ))}
          </div>
        </div>

        {/* what happens next (desktop/tablet only; the stages below cover it on phones) */}
        <div className="hidden border-t border-stone-200 bg-[#fbfaf7] p-4 sm:block lg:border-l lg:border-t-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-600">Then</p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <li className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-[11px] font-semibold text-stone-600">Queued</p>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-900">{lead.slot}</p>
              <p className="text-[11px] text-stone-600">Inside business hours, randomized gap</p>
              <div className="relative mt-2.5 h-6" aria-hidden="true">
                <div className="absolute inset-x-0 top-1/2 h-px bg-stone-200" />
                <div className="absolute left-[18%] right-[22%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-100" />
                {[22, 31, 37, 49, 58, 66, 74].map((x, i) => (
                  <span
                    key={x}
                    className={`absolute top-1/2 w-[2px] -translate-y-1/2 rounded-full ${
                      i === 4 ? 'lp-blink h-4 bg-brand-deep-600' : 'h-3 bg-brand-400'
                    }`}
                    style={{ left: `${x}%` }}
                  />
                ))}
              </div>
            </li>
            <li className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-[11px] font-semibold text-stone-600">Follow-ups</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                {['+2d', '+5d', '+9d'].map((d) => (
                  <span key={d} className="rounded-md bg-brand-deep-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-deep-800">
                    {d}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-stone-600">
                With the engagement gate on, only if they opened or clicked. Each takes a new angle.
              </p>
            </li>
            <li className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-[11px] font-semibold text-stone-600">Tracking</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-stone-700">
                Opens, clicks with UTM tags, replies matched by thread.
              </p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-stone-600">
                <Ban size={11} aria-hidden="true" /> One-click unsubscribe included
              </p>
            </li>
          </ol>
        </div>
      </div>

      {/* phone lead switch */}
      <div className="flex items-center justify-center gap-2 border-t border-stone-200 bg-stone-50/80 px-4 py-2.5 sm:hidden">
        <LeadSwitch idx={idx} onPick={pick} mobile />
      </div>
    </div>
  );
}
