/**
 * "From your email campaigns" - Google Analytics sessions / users / key events
 * that arrived with the brand's outreach utm_source, broken down by campaign
 * (utm_campaign) and sender persona (utm_term), plus the site's overall
 * traffic sources for context.
 */

import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CalendarDays,
  FileText,
  Info,
  Loader2,
  Mail,
  Megaphone,
  MousePointerClick,
  Route,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { GaError, GaSummary, GaSummaryDays } from '../../lib/googleAnalytics';
import { engagementPct, fmtNum, prettifyCampaign, prettifyPersona, sharePct, shortDate } from './gaFormat';
import { GaErrorState, RankedList, SkeletonBlock, StaleWarning, WidgetCard } from './gaWidgets';

const DAY_OPTIONS: GaSummaryDays[] = [7, 28, 90];
const MAX_ROWS = 6;

interface EmailCampaignsPanelProps {
  summary: GaSummary | null;
  error: GaError | null;
  loading: boolean;
  refreshing: boolean;
  days: GaSummaryDays;
  onDaysChange: (days: GaSummaryDays) => void;
  highlightSource: string | null;
  canManage: boolean;
  onRetry: () => void;
}

export function EmailCampaignsPanel({
  summary,
  error,
  loading,
  refreshing,
  days,
  onDaysChange,
  highlightSource,
  canManage,
  onRetry,
}: EmailCampaignsPanelProps) {
  const source = summary?.highlight_source || highlightSource;

  return (
    <section aria-labelledby="ga-email-heading" className="mt-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-pink-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <Mail className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="ga-email-heading" className="text-lg font-bold text-gray-900">
            From your email campaigns{' '}
            <span className="text-gray-400 font-semibold text-base">(last {days} days)</span>
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {source ? (
              <>
                Website visits tagged{' '}
                <code className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono break-all">
                  utm_source={source}
                </code>
              </>
            ) : (
              'Set the outreach utm_source in Settings > Integrations to highlight email traffic.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 basis-full sm:basis-auto justify-end">
          {refreshing && <Loader2 size={16} className="animate-spin text-gray-400" aria-label="Refreshing" />}
          <div role="group" aria-label="Date range" className="inline-flex rounded-xl bg-gray-100 p-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDaysChange(d)}
                aria-pressed={days === d}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !summary ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SkeletonBlock className="h-56" />
            <SkeletonBlock className="h-56" />
            <SkeletonBlock className="h-56" />
          </div>
        </div>
      ) : !summary ? (
        error ? <GaErrorState error={error} canManage={canManage} onRetry={onRetry} /> : null
      ) : (
        <SummaryBody summary={summary} error={error} days={days} source={source} />
      )}
    </section>
  );
}

function SummaryBody({
  summary,
  error,
  days,
  source,
}: {
  summary: GaSummary;
  error: GaError | null;
  days: number;
  source: string | null;
}) {
  const { email, totals } = summary;
  const sessionShare = sharePct(email.totals.sessions, totals.sessions);
  const userShare = sharePct(email.totals.users, totals.users);
  const keyRate = email.totals.sessions > 0 ? (email.totals.key_events / email.totals.sessions) * 100 : null;
  const noEmailTraffic = email.totals.sessions === 0;

  const sources = [...summary.sources].sort((a, b) => b.sessions - a.sessions).slice(0, MAX_ROWS);
  const topSourceSessions = Math.max(...sources.map((s) => s.sessions), 1);

  return (
    <div className="space-y-4">
      {error && <StaleWarning error={error} />}

      {/* Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile
          icon={MousePointerClick}
          gradient="from-purple-500 to-violet-600"
          label="Sessions"
          value={email.totals.sessions}
          hint={sessionShare !== null ? `${sessionShare}% of all site sessions` : 'No site sessions yet'}
          delay={0}
        />
        <Tile
          icon={Users}
          gradient="from-blue-500 to-indigo-600"
          label="Users"
          value={email.totals.users}
          hint={userShare !== null ? `${userShare}% of all site users` : 'No site users yet'}
          delay={0.05}
        />
        <Tile
          icon={Target}
          gradient="from-orange-500 to-amber-600"
          label="Key events"
          value={email.totals.key_events}
          hint={keyRate !== null ? `${keyRate.toFixed(1)} per 100 sessions` : 'Conversions from email visits'}
          delay={0.1}
        />
      </div>

      {noEmailTraffic && (
        <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-4 text-sm text-purple-900">
          <Info className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
          <p>
            No website visits from outreach emails in the last {days} days yet.
            {source ? (
              <>
                {' '}
                Links to your website in outreach emails are tagged <b className="font-mono">utm_source={source}</b>{' '}
                automatically, so visits appear here once recipients click through.
              </>
            ) : null}{' '}
            Google can take a few hours to process new visits.
          </p>
        </div>
      )}

      {/* Daily + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <WidgetCard title="Daily sessions" icon={CalendarDays} color="orange" subtitle="From outreach emails" delay={0.1}>
          {email.daily.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No daily data yet</p>
          ) : (
            <div className="h-[200px]" role="img" aria-label={`Daily sessions from outreach emails over the last ${days} days`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={email.daily} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gaEmailDailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => shortDate(String(v))}
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={18}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #e5e7eb',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => shortDate(String(v))}
                    formatter={(value) => [fmtNum(Number(value)), 'Sessions']}
                  />
                  <Area
                    type="monotone"
                    dataKey="sessions"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#gaEmailDailyFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="By campaign" icon={Megaphone} color="purple" subtitle="utm_campaign" delay={0.15}>
          <BreakdownRows
            rows={email.by_campaign.map((r) => ({
              key: r.campaign,
              label: prettifyCampaign(r.campaign),
              title: r.campaign,
              sessions: r.sessions,
              users: r.users,
              keyEvents: r.key_events,
            }))}
            barClass="from-purple-500 to-violet-500"
            empty="No campaign visits yet"
          />
        </WidgetCard>

        <WidgetCard title="By sender persona" icon={UserRound} color="blue" subtitle="utm_term" delay={0.2}>
          <BreakdownRows
            rows={email.by_sender.map((r) => ({
              key: r.sender,
              label: prettifyPersona(r.sender),
              title: r.sender,
              sessions: r.sessions,
              users: r.users,
              keyEvents: r.key_events,
              avatar: true,
            }))}
            barClass="from-blue-500 to-indigo-500"
            empty="No sender visits yet"
          />
        </WidgetCard>
      </div>

      {/* Landing pages + all sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard title="Landing pages" icon={FileText} color="pink" subtitle="Where email visitors arrive" delay={0.2}>
          <RankedList
            items={email.landing_pages
              .slice()
              .sort((a, b) => b.sessions - a.sessions)
              .map((p) => ({ key: p.page, label: p.page, value: p.sessions }))}
            color="pink"
            empty="No landing pages yet"
            valueLabel="sessions"
          />
        </WidgetCard>

        <WidgetCard
          title="All traffic sources"
          icon={Route}
          color="emerald"
          subtitle={`Whole site: ${fmtNum(totals.sessions)} sessions, ${engagementPct(totals.engagement_rate)}% engaged`}
          delay={0.25}
        >
          {sources.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No traffic recorded in this period</p>
          ) : (
            <ul className="space-y-1.5">
              {sources.map((s) => {
                const mine = !!source && s.source.toLowerCase() === source.toLowerCase();
                return (
                  <li
                    key={`${s.source}/${s.medium}`}
                    className={`relative rounded-lg overflow-hidden ${mine ? 'ring-1 ring-purple-300' : ''}`}
                  >
                    <div
                      className={`absolute inset-y-0 left-0 rounded-lg ${mine ? 'bg-purple-100' : 'bg-emerald-50'}`}
                      style={{ width: `${Math.max(4, (s.sessions / topSourceSessions) * 100)}%` }}
                      aria-hidden="true"
                    />
                    <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="truncate flex-1 min-w-0 text-gray-700" title={`${s.source} / ${s.medium}`}>
                        {s.source} <span className="text-gray-400">/ {s.medium}</span>
                      </span>
                      {mine && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-purple-700 bg-white/80 border border-purple-200 px-1.5 py-0.5 rounded-full">
                          Your emails
                        </span>
                      )}
                      <span className="font-semibold text-gray-900 tabular-nums">{fmtNum(s.sessions)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}

function Tile({
  icon: Icon,
  gradient,
  label,
  value,
  hint,
  delay,
}: {
  icon: LucideIcon;
  gradient: string;
  label: string;
  value: number;
  hint: string;
  delay: number;
}) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 relative overflow-hidden group hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div
        className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`}
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(value)}</p>
          <p className="text-xs text-gray-500 mt-1 truncate">{hint}</p>
        </div>
        <div
          className={`h-12 w-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg flex-shrink-0`}
        >
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </motion.div>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  title: string;
  sessions: number;
  users: number;
  keyEvents: number;
  avatar?: boolean;
}

function BreakdownRows({ rows, barClass, empty }: { rows: BreakdownRow[]; barClass: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 py-10 text-center">{empty}</p>;
  const sorted = [...rows].sort((a, b) => b.sessions - a.sessions);
  const shown = sorted.slice(0, MAX_ROWS);
  const top = Math.max(...shown.map((r) => r.sessions), 1);
  return (
    <ul className="space-y-3">
      {shown.map((r) => (
        <li key={r.key}>
          <div className="flex items-center gap-2 text-sm">
            {r.avatar && (
              <span
                className={`h-6 w-6 rounded-full bg-gradient-to-br ${barClass} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0`}
                aria-hidden="true"
              >
                {initials(r.label)}
              </span>
            )}
            <span className="truncate flex-1 min-w-0 font-medium text-gray-800" title={r.title}>
              {r.label}
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{fmtNum(r.sessions)}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${barClass} transition-[width] duration-500`}
              style={{ width: `${Math.max(3, (r.sessions / top) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-500 tabular-nums">
            {fmtNum(r.sessions)} sessions · {fmtNum(r.users)} users · {fmtNum(r.keyEvents)} key events
          </p>
        </li>
      ))}
      {rows.length > MAX_ROWS && <li className="text-xs text-gray-400">+{rows.length - MAX_ROWS} more</li>}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
