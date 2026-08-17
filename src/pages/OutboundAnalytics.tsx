import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  BarChart3, TrendingUp, Send, Eye, MousePointerClick, MessageCircle,
  AlertTriangle, Users, Target, Megaphone, Trophy, Clock,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Overview {
  sent: number; opened: number; clicked: number; replied: number; bounced: number;
  open_rate: number; click_rate: number; reply_rate: number; bounce_rate: number; days: number;
}
interface TimePoint { date: string; sent: number; opened: number; clicked: number; replied: number; }
interface PersonaRow { from_email: string; name: string; sent: number; opened: number; replied: number; open_rate: number; reply_rate: number; }
interface SegmentRow { segment: string; sent: number; opened: number; replied: number; open_rate: number; reply_rate: number; }
interface CampaignRow { name: string; sent: number; opened: number; replied: number; open_rate: number; reply_rate: number; }

interface SummaryResponse {
  overview: Overview;
  timeseries: TimePoint[];
  personas: PersonaRow[];
  segments: SegmentRow[];
  campaigns: CampaignRow[];
}

const PERIODS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time', days: 0 },
] as const;

const fmtPct = (v: number) => `${(v ?? 0).toFixed(1)}%`;
const fmtNum = (v: number) => (v ?? 0).toLocaleString();
const formatChartDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function OutboundAnalytics() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analytics-outbound/summary?days=${d}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load outbound analytics');
      const json = (await res.json()) as SummaryResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load outbound analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(days); }, [days]);

  const overview = data?.overview;
  const timeseries = data?.timeseries || [];
  const personas = [...(data?.personas || [])].sort((a, b) => b.sent - a.sent);
  const segments = [...(data?.segments || [])].sort((a, b) => b.sent - a.sent);
  const campaigns = [...(data?.campaigns || [])].sort((a, b) => b.sent - a.sent);
  const bestReplyRate = personas.length ? Math.max(...personas.map((p) => p.reply_rate)) : 0;

  const kpis = overview ? [
    { title: 'Sent', value: fmtNum(overview.sent), subtitle: 'emails delivered', icon: Send, gradient: 'from-blue-500 to-blue-600' },
    { title: 'Open Rate', value: fmtPct(overview.open_rate), subtitle: `${fmtNum(overview.opened)} opened`, icon: Eye, gradient: 'from-amber-500 to-amber-600' },
    { title: 'Click Rate', value: fmtPct(overview.click_rate), subtitle: `${fmtNum(overview.clicked)} clicked`, icon: MousePointerClick, gradient: 'from-cyan-500 to-blue-600' },
    { title: 'Reply Rate', value: fmtPct(overview.reply_rate), subtitle: `${fmtNum(overview.replied)} replied`, icon: MessageCircle, gradient: 'from-emerald-500 to-emerald-600' },
    { title: 'Bounce Rate', value: fmtPct(overview.bounce_rate), subtitle: `${fmtNum(overview.bounced)} bounced`, icon: AlertTriangle, gradient: 'from-orange-500 to-red-600' },
  ] : [];

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div className="mb-6" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Outbound Analytics
              </h1>
              <p className="text-gray-600 text-sm mt-0.5">How your cold-outreach emails are performing</p>
            </div>
          </div>

          {/* Period selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Period
            </span>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  days === p.days
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-500">
          <motion.div
            className="h-14 w-14 border-4 border-indigo-600 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="mt-4 font-medium">Loading outbound analytics…</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm max-w-lg mx-auto mt-12">
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Failed to load</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => fetchData(days)}
            className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
          >
            Try Again
          </button>
        </div>
      ) : !overview ? null : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 mb-8">
            {kpis.map((k, i) => (
              <KpiCard key={k.title} {...k} delay={i * 0.05} />
            ))}
          </div>

          {/* Trend chart */}
          <motion.div
            className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Outreach Trend</h2>
                <p className="text-sm text-gray-500">Emails sent, opened & replied over time</p>
              </div>
            </div>

            {timeseries.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                No activity in this period. Send some outreach to see trends here.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={timeseries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oaSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="oaOpened" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="oaReplied" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 12 }}
                    labelFormatter={(v) => formatChartDate(String(v))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                  <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2} fill="url(#oaSent)" dot={false} />
                  <Area type="monotone" dataKey="opened" name="Opened" stroke="#f59e0b" strokeWidth={2} fill="url(#oaOpened)" dot={false} />
                  <Area type="monotone" dataKey="replied" name="Replied" stroke="#10b981" strokeWidth={2} fill="url(#oaReplied)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* By persona leaderboard */}
          <motion.div
            className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-3">
              <div className="h-10 w-10 bg-gradient-to-br from-fuchsia-600 to-purple-600 rounded-xl flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">By Persona</h2>
                <p className="text-sm text-gray-500">Which sender is landing replies</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-6 py-3 font-semibold uppercase tracking-wider text-xs">Persona</th>
                    <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Sent</th>
                    <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Open %</th>
                    <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Reply %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {personas.map((p) => {
                    const isBest = p.reply_rate === bestReplyRate && bestReplyRate > 0;
                    return (
                      <tr key={p.from_email} className={isBest ? 'bg-emerald-50/60' : 'hover:bg-gray-50'}>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm shadow">
                              {(p.name || p.from_email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 flex items-center gap-1.5 truncate">
                                {p.name || p.from_email}
                                {isBest && <Trophy className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
                              </p>
                              <p className="text-xs text-gray-400 truncate">{p.from_email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right tabular-nums text-gray-900 font-medium">{fmtNum(p.sent)}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-amber-600 font-medium">{fmtPct(p.open_rate)}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-emerald-600 font-semibold">{fmtPct(p.reply_rate)}</td>
                      </tr>
                    );
                  })}
                  {personas.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400">No persona data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* By segment + By campaign */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BreakdownTable
              title="By Segment"
              subtitle="Which audiences respond best"
              icon={Target}
              gradient="from-cyan-500 to-blue-600"
              colLabel="Segment"
              rows={segments.map((s) => ({ label: s.segment, sent: s.sent, open_rate: s.open_rate, reply_rate: s.reply_rate }))}
              delay={0.4}
            />
            <BreakdownTable
              title="By Campaign"
              subtitle="Performance per campaign"
              icon={Megaphone}
              gradient="from-emerald-500 to-teal-600"
              colLabel="Campaign"
              rows={campaigns.map((c) => ({ label: c.name, sent: c.sent, open_rate: c.open_rate, reply_rate: c.reply_rate }))}
              delay={0.45}
            />
          </div>
        </>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  delay: number;
}

function KpiCard({ title, value, subtitle, icon: Icon, gradient, delay }: KpiCardProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 relative overflow-hidden group hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
    >
      <div className={`absolute top-0 right-0 w-28 h-28 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`} />
      <div className="relative">
        <div className={`h-11 w-11 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg mb-4`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{title}</h3>
        <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </motion.div>
  );
}

interface BreakdownRow { label: string; sent: number; open_rate: number; reply_rate: number; }
interface BreakdownTableProps {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  colLabel: string;
  rows: BreakdownRow[];
  delay: number;
}

function BreakdownTable({ title, subtitle, icon: Icon, gradient, colLabel, rows, delay }: BreakdownTableProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-3">
        <div className={`h-10 w-10 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
            <tr>
              <th className="text-left px-6 py-3 font-semibold uppercase tracking-wider text-xs">{colLabel}</th>
              <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Sent</th>
              <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Open %</th>
              <th className="text-right px-6 py-3 font-semibold uppercase tracking-wider text-xs">Reply %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900 truncate max-w-[14rem]">{r.label || '—'}</td>
                <td className="px-6 py-3 text-right tabular-nums text-gray-900 font-medium">{fmtNum(r.sent)}</td>
                <td className="px-6 py-3 text-right tabular-nums text-amber-600 font-medium">{fmtPct(r.open_rate)}</td>
                <td className="px-6 py-3 text-right tabular-nums text-emerald-600 font-semibold">{fmtPct(r.reply_rate)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400">No data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
