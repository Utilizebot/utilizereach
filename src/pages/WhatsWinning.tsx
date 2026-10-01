import { useState, useEffect } from 'react';
import {
  Trophy, Sparkles, RefreshCw, Loader2, Users, Zap, Eye, ChevronRight, AlertCircle, X, MousePointerClick,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Perf {
  ai_vs_template: { kind: string; sent: number; open_rate: number; reply_rate: number; bounce_rate: number }[];
  accounts: { from_email: string; sent: number; open_rate: number; reply_rate: number }[];
  subjects: { subject: string; sent: number; open_rate: number }[];
  segments: { segment: string; sent: number; open_rate: number; reply_rate: number }[];
  overall: { sent?: number; open_rate?: number; reply_rate?: number; bounce_rate?: number };
}
interface Rec { title: string; detail: string; impact: string }
interface Drill { dim: string; value: string; label: string }

const kindColor = (k: string) =>
  k === 'AI intro' ? 'from-blue-500 to-blue-600'
    : k === 'Template A/B' ? 'from-amber-500 to-amber-600'
      : k === 'AI follow-up' ? 'from-indigo-400 to-indigo-600'
        : 'from-red-400 to-rose-500';

const impactStyle: Record<string, { bar: string; chip: string; label: string }> = {
  high: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700', label: 'High impact' },
  medium: { bar: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', label: 'Medium' },
  low: { bar: 'bg-gray-300', chip: 'bg-gray-100 text-gray-500', label: 'Low' },
};
const dimLabel: Record<string, string> = { type: 'Email type', account: 'Sender persona', subject: 'Subject line', segment: 'Segment', status: 'Delivery status' };

export function WhatsWinning() {
  const [perf, setPerf] = useState<Perf | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recErr, setRecErr] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);

  const loadRecs = async () => {
    setRecLoading(true); setRecErr('');
    try {
      const r = await fetch(`${API_BASE}/api/insights/recommendations`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Failed');
      setRecs(d.recommendations || []);
    } catch (e: any) { setRecErr(e.message || 'Could not generate recommendations'); }
    setRecLoading(false);
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/insights/performance`, { cache: 'no-store' }).then((r) => r.json()).then(setPerf).catch(() => {});
    loadRecs();
  }, []);

  const o = perf?.overall || {};
  const accMax = Math.max(70, ...(perf?.accounts || []).map((a) => a.open_rate));
  const cmpMax = Math.max(70, ...(perf?.ai_vs_template || []).map((k) => k.open_rate));
  const hint = <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 font-medium"><MousePointerClick className="h-3 w-3" /> click for samples</span>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Trophy className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">What's Winning</h1>
            <p className="text-sm text-gray-500">What's driving opens — click anything to see real examples.</p>
          </div>
        </div>
        {perf && (
          <div className="flex gap-2">
            {([['Sent', 'sent', o.sent ?? 0], ['Open', 'opened', `${o.open_rate ?? 0}%`], ['Bounce', 'bounced', `${o.bounce_rate ?? 0}%`]] as const).map(([l, statusVal, v]) => (
              <button key={l} onClick={() => setDrill({ dim: 'status', value: statusVal, label: `${l} emails` })}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 shadow-sm text-center hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
                <div className="text-lg font-bold text-gray-900 tabular-nums">{v}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{l}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI RECOMMENDATIONS */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5 shadow-sm mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow"><Sparkles className="h-4 w-4 text-white" /></div>
            <div>
              <h2 className="font-bold text-gray-900 leading-tight">AI Recommendations</h2>
              <p className="text-xs text-gray-500">The AI analysed your live data and suggests where to improve.</p>
            </div>
          </div>
          <button onClick={loadRecs} disabled={recLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${recLoading ? 'animate-spin' : ''}`} /> {recLoading ? 'Analysing…' : 'Regenerate'}
          </button>
        </div>
        {recLoading && !recs ? (
          <div className="flex items-center gap-2 text-indigo-600 text-sm py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Analysing your outreach data…</div>
        ) : recErr ? (
          <div className="flex items-center gap-2 text-sm text-red-600 mt-4"><AlertCircle className="h-4 w-4" /> {recErr}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            {(recs || []).map((r, i) => {
              const s = impactStyle[r.impact] || impactStyle.medium;
              return (
                <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex">
                  <div className={`w-1.5 flex-none ${s.bar}`} />
                  <div className="p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${s.chip}`}>{s.label}</span>
                      <h3 className="font-bold text-gray-900 text-sm">{r.title}</h3>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{r.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!perf ? (
        <div className="flex items-center justify-center py-20 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading performance…</div>
      ) : (
        <>
          {/* AI vs template */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100 rounded-2xl p-5 shadow-sm mb-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wide"><Zap className="h-4 w-4" /> The big signal</div>
              {hint}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-1">AI-personalized is winning</h2>
            <div className="flex flex-col gap-2 mt-4">
              {perf.ai_vs_template.map((k) => (
                <button key={k.kind} onClick={() => setDrill({ dim: 'type', value: k.kind, label: k.kind })}
                  className="grid grid-cols-[110px_1fr_46px] items-center gap-3 text-left rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-white/70 transition-colors group">
                  <div className="text-[13px] font-semibold text-gray-600 group-hover:text-blue-700 flex items-center gap-1">{k.kind}<ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                  <div className="h-7 rounded-lg bg-white/70 overflow-hidden shadow-inner">
                    <div className={`h-full rounded-lg bg-gradient-to-r ${kindColor(k.kind)} transition-all duration-700`} style={{ width: `${(k.open_rate / cmpMax) * 100}%` }} />
                  </div>
                  <div className="text-right font-bold tabular-nums text-sm text-gray-900">{k.open_rate}%</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">Open rate shown. Bounce: AI intro {perf.ai_vs_template.find((x) => x.kind === 'AI intro')?.bounce_rate ?? '–'}% vs Template A/B {perf.ai_vs_template.find((x) => x.kind === 'Template A/B')?.bounce_rate ?? '–'}%.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* best accounts */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-600" /><h2 className="font-bold text-gray-900">Best account (sender)</h2></div>
                {hint}
              </div>
              <p className="text-xs text-gray-500 mb-4">Open rate per persona. Weight volume toward the top.</p>
              <div className="flex flex-col gap-1">
                {perf.accounts.map((a, i) => (
                  <button key={a.from_email} onClick={() => setDrill({ dim: 'account', value: a.from_email, label: a.from_email.split('@')[0] })}
                    className="grid grid-cols-[20px_1fr_44px] items-center gap-2.5 text-left rounded-lg -mx-1.5 px-1.5 py-1.5 hover:bg-gray-50 transition-colors">
                    <div className={`font-bold tabular-nums text-sm ${i === 0 ? 'text-amber-500' : 'text-gray-300'}`}>{i + 1}</div>
                    <div>
                      <div className="text-[13px] font-semibold text-gray-800 capitalize">{a.from_email.split('@')[0]}
                        {a.reply_rate > 0 && <span className="text-[11px] text-gray-400 font-medium ml-1.5">{a.reply_rate}% reply</span>}</div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-1">
                        <div className={`h-full rounded-full transition-all duration-700 ${i === perf.accounts.length - 1 ? 'bg-gradient-to-r from-slate-300 to-slate-400' : 'bg-gradient-to-r from-blue-400 to-blue-600'}`} style={{ width: `${(a.open_rate / accMax) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right font-bold tabular-nums text-[13px] text-gray-900">{a.open_rate}%</div>
                  </button>
                ))}
              </div>
            </div>

            {/* best subjects */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><Eye className="h-4 w-4 text-amber-600" /><h2 className="font-bold text-gray-900">Best subject lines</h2></div>
                {hint}
              </div>
              <p className="text-xs text-gray-500 mb-2">Winning angles — feed these into the AI brief.</p>
              <div className="flex flex-col">
                {perf.subjects.slice(0, 8).map((s, i) => (
                  <button key={i} onClick={() => setDrill({ dim: 'subject', value: s.subject, label: s.subject })}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-0 text-left hover:bg-gray-50 rounded-lg -mx-1.5 px-1.5 transition-colors">
                    <div className="text-[13px] font-medium text-gray-700 truncate">
                      {s.subject}
                      {/malay|english|bilingual/i.test(s.subject) && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase">bilingual</span>}
                      {s.subject.includes('?') && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase">question</span>}
                    </div>
                    <div className="flex items-center gap-2.5 flex-none">
                      <span className="font-bold tabular-nums text-sm text-blue-600">{s.open_rate}%</span>
                      <span className="text-[11px] text-gray-400 font-semibold whitespace-nowrap">{s.sent} sent</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* segments */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mt-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-emerald-600" /><h2 className="font-bold text-gray-900">Best segment</h2></div>
              {hint}
            </div>
            <p className="text-xs text-gray-500 mb-4">Where your best-quality leads convert.</p>
            <div className="flex gap-3 flex-wrap">
              {perf.segments.map((s) => (
                <button key={s.segment} onClick={() => setDrill({ dim: 'segment', value: s.segment, label: s.segment })}
                  className="flex-1 min-w-[160px] border border-gray-200 rounded-xl p-4 text-center hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
                  <div className="text-[13px] font-bold text-gray-700">{s.segment}</div>
                  <div className="text-2xl font-bold text-blue-600 tabular-nums mt-1">{s.open_rate}%</div>
                  <div className="text-[11px] text-gray-400 font-semibold mt-0.5">{s.sent} sent{s.reply_rate > 0 ? ` · ${s.reply_rate}% reply` : ''}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {drill && <DrillModal key={drill.dim + drill.value} drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function Pill({ on, tone, label }: { on: boolean; tone: string; label: string }) {
  if (!on) return null;
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tone}`}>{label}</span>;
}

function DrillModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/insights/samples?dim=${encodeURIComponent(drill.dim)}&value=${encodeURIComponent(drill.value)}&limit=6`, { cache: 'no-store' })
      .then((r) => r.json()).then((x) => { if (x.detail) setErr(true); else setD(x); }).catch(() => setErr(true));
  }, [drill]);
  const st = d?.stats || {};
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100 gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">{dimLabel[drill.dim] || drill.dim}</div>
            <h3 className="font-bold text-gray-900 text-lg capitalize truncate">{drill.label}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 flex-none"><X className="h-5 w-5" /></button>
        </div>
        {!d && !err ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading examples…</div>
        ) : err ? (
          <div className="p-6 text-sm text-red-600 flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Couldn't load examples.</div>
        ) : (
          <div className="p-5 space-y-4">
            {d.explain && <div className="rounded-xl bg-blue-50 border border-blue-100 p-3.5 text-sm text-gray-700 leading-relaxed">{d.explain}</div>}
            <div className="grid grid-cols-4 gap-2">
              {[['Sent', st.sent], ['Open', `${st.open_rate ?? 0}%`], ['Reply', `${st.reply_rate ?? 0}%`], ['Bounce', `${st.bounce_rate ?? 0}%`]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-gray-50 py-2 text-center">
                  <div className="font-bold text-gray-900 tabular-nums text-sm">{v as any}</div>
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">{l as string}</div>
                </div>
              ))}
            </div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sample emails ({d.samples.length})</div>
            <div className="space-y-2.5">
              {d.samples.map((s: any, i: number) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold text-gray-900 text-sm">{s.subject || '(no subject)'}</div>
                    <div className="flex gap-1 flex-none">
                      <Pill on={s.opened} tone="bg-emerald-100 text-emerald-700" label="Opened" />
                      <Pill on={s.clicked} tone="bg-blue-100 text-blue-700" label="Clicked" />
                      <Pill on={s.replied} tone="bg-purple-100 text-purple-700" label="Replied" />
                      <Pill on={s.bounced} tone="bg-red-100 text-red-700" label="Bounced" />
                    </div>
                  </div>
                  {s.preview && <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-3">{s.preview}</p>}
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-400 font-medium">
                    <span className="capitalize">{(s.from_email || '').split('@')[0]}</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="truncate">{s.recipient_name || s.recipient_email}</span>
                    {s.variant && <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-none">{s.variant}</span>}
                  </div>
                </div>
              ))}
              {d.samples.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No sample emails found.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
