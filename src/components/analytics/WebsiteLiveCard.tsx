/**
 * WebsiteLiveCard - "Website live" section on the Dashboard, powered by the
 * brand's Google Analytics 4 connection (Settings > Integrations).
 *
 * - Connected + property chosen + "show on dashboard": active users in the
 *   last 30 minutes (GA's realtime window), a per-minute chart, top pages
 *   (by page title) / countries / devices, and the "From your email
 *   campaigns" panel, plus a compact last-28-days row (visitors, visits,
 *   page views, top countries) linking to /website-analytics.
 * - /realtime is polled every 30 s, /summary every 5 min; both pause while
 *   the tab is hidden and are aborted on unmount.
 * - Not connected: brand admins (settings.manage) get a slim dismissible
 *   call to action; everyone else sees nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileText,
  Globe,
  Monitor,
  RefreshCw,
  Settings2,
  Smartphone,
  Tablet,
  Tv,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { usePolling } from '../../hooks/usePolling';
import {
  GA_SETTINGS_PATH,
  GaApiError,
  gaErrorMessage,
  getGaRealtime,
  getGaStatus,
  getGaSummary,
  isAbortError,
  isConnectionError,
  type GaError,
  type GaMinute,
  type GaNamedCount,
  type GaRealtime,
  type GaStatus,
  type GaSummary,
  type GaSummaryDays,
} from '../../lib/googleAnalytics';
import { EmailCampaignsPanel } from './EmailCampaignsPanel';
import { WebsiteSummaryRow } from './WebsiteSummaryRow';
import { fmtNum, sharePct } from './gaFormat';
import { GaErrorState, RankedList, SkeletonBlock, StaleWarning, UpdatedAgo, WidgetCard } from './gaWidgets';

const REALTIME_INTERVAL_MS = 30_000;
const SUMMARY_INTERVAL_MS = 5 * 60_000;
/** Re-check /status at most this often after a connection-type error. */
const STATUS_RECHECK_MS = 60_000;
const CTA_DISMISS_KEY = 'utilizereach.ga_cta_dismissed';

function readDismissed(brandKey: string): boolean {
  try {
    return localStorage.getItem(`${CTA_DISMISS_KEY}.${brandKey}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(brandKey: string): void {
  try {
    localStorage.setItem(`${CTA_DISMISS_KEY}.${brandKey}`, '1');
  } catch {
    /* storage unavailable - dismiss for this view only */
  }
}

function toGaError(e: unknown, fallback: string): GaError {
  const code = e instanceof GaApiError && e.code ? e.code : 'upstream_error';
  const message = e instanceof Error && e.message ? e.message : gaErrorMessage(code, fallback);
  return { code, message };
}

// ===========================================================================
// Entry point: decides what (if anything) to show
// ===========================================================================

export function WebsiteLiveCard() {
  const { can, activeBrand } = useAuth();
  const canView = can('analytics.view');
  const canManage = can('settings.manage');
  const brandKey = activeBrand?.id || 'default';

  const [status, setStatus] = useState<GaStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(brandKey));
  const statusAbort = useRef<AbortController | null>(null);
  const lastStatusCheck = useRef(0);

  const loadStatus = useCallback(async () => {
    statusAbort.current?.abort();
    const ctl = new AbortController();
    statusAbort.current = ctl;
    lastStatusCheck.current = Date.now();
    try {
      const s = await getGaStatus(ctl.signal);
      if (!ctl.signal.aborted) setStatus(s);
    } catch {
      // Integration unavailable (older backend, network, no permission):
      // the dashboard simply shows nothing for it.
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void loadStatus();
    return () => statusAbort.current?.abort();
  }, [canView, loadStatus]);

  /** Called by the live panels on reconnect / permission / property errors. */
  const recheckStatus = useCallback(() => {
    if (Date.now() - lastStatusCheck.current < STATUS_RECHECK_MS) return;
    void loadStatus();
  }, [loadStatus]);

  const dismiss = () => {
    writeDismissed(brandKey);
    setDismissed(true);
  };

  if (!canView || !status) return null;

  const state = status.status;
  const visibleOnDashboard = status.show_on_dashboard && !!status.property_id;

  if (state === 'reconnect_required') {
    if (!visibleOnDashboard) return null;
    return (
      <SlimBanner
        tone="amber"
        icon={AlertTriangle}
        text={
          canManage
            ? 'Google Analytics access expired or was revoked. Reconnect it to keep seeing live website visitors.'
            : 'Live website stats are paused until a brand admin reconnects Google Analytics.'
        }
        action={canManage ? { to: GA_SETTINGS_PATH, label: 'Reconnect' } : undefined}
      />
    );
  }

  if (state !== 'connected') {
    if (!canManage || dismissed) return null;
    return (
      <SlimBanner
        tone="cta"
        icon={BarChart3}
        text="Connect Google Analytics to see live website visitors"
        sub="And which email campaigns and sender personas bring people to your site."
        action={{ to: GA_SETTINGS_PATH, label: 'Connect' }}
        onDismiss={dismiss}
      />
    );
  }

  if (!status.property_id) {
    if (!canManage || dismissed) return null;
    return (
      <SlimBanner
        tone="cta"
        icon={BarChart3}
        text="Google Analytics is connected. Choose a property to see live website visitors here."
        action={{ to: GA_SETTINGS_PATH, label: 'Choose property' }}
        onDismiss={dismiss}
      />
    );
  }

  if (!status.show_on_dashboard) return null;

  return (
    <LiveAnalytics
      key={status.property_id}
      status={status}
      canManage={canManage}
      onConnectionProblem={recheckStatus}
    />
  );
}

// ===========================================================================
// Slim banners (CTA / attention)
// ===========================================================================

function SlimBanner({
  tone,
  icon: Icon,
  text,
  sub,
  action,
  onDismiss,
}: {
  tone: 'cta' | 'amber';
  icon: LucideIcon;
  text: string;
  sub?: string;
  action?: { to: string; label: string };
  onDismiss?: () => void;
}) {
  const cta = tone === 'cta';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-3 sm:p-4 flex items-center gap-3 shadow-sm ${
        cta
          ? 'border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-purple-50'
          : 'border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50'
      }`}
    >
      <div
        className={`h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md flex-shrink-0 ${
          cta ? 'from-orange-500 to-amber-500' : 'from-amber-500 to-orange-600'
        }`}
      >
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${cta ? 'text-gray-900' : 'text-amber-900'}`}>{text}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5 hidden sm:block">{sub}</p>}
      </div>
      {action && (
        <Link
          to={action.to}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg transition-all whitespace-nowrap"
        >
          {action.label}
        </Link>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white/70 transition-colors flex-shrink-0"
        >
          <X size={16} />
        </button>
      )}
    </motion.div>
  );
}

// ===========================================================================
// Live analytics (realtime + summary, with polling)
// ===========================================================================

function LiveAnalytics({
  status,
  canManage,
  onConnectionProblem,
}: {
  status: GaStatus;
  canManage: boolean;
  onConnectionProblem: () => void;
}) {
  const [realtime, setRealtime] = useState<GaRealtime | null>(null);
  const [rtError, setRtError] = useState<GaError | null>(null);
  const [rtLoading, setRtLoading] = useState(true);
  const [rtRefreshing, setRtRefreshing] = useState(false);

  const [summary, setSummary] = useState<GaSummary | null>(null);
  const [sumError, setSumError] = useState<GaError | null>(null);
  const [sumLoading, setSumLoading] = useState(true);
  const [sumRefreshing, setSumRefreshing] = useState(false);
  const [days, setDays] = useState<GaSummaryDays>(7);

  const rtAbort = useRef<AbortController | null>(null);
  const sumAbort = useRef<AbortController | null>(null);

  const loadRealtime = useCallback(async () => {
    rtAbort.current?.abort();
    const ctl = new AbortController();
    rtAbort.current = ctl;
    setRtRefreshing(true);
    try {
      const r = await getGaRealtime(ctl.signal);
      if (ctl.signal.aborted) return;
      const err = r.error ?? (r.connected ? undefined : { code: 'not_connected', message: gaErrorMessage('not_connected') });
      // A transient error can come with the last good (cached) data: show it.
      if (!err || r.cached) setRealtime(r);
      setRtError(err ?? null);
      if (err && isConnectionError(err.code)) onConnectionProblem();
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) return;
      const err = toGaError(e, 'Could not load live website stats');
      setRtError(err);
      if (isConnectionError(err.code)) onConnectionProblem();
    } finally {
      if (!ctl.signal.aborted) {
        setRtLoading(false);
        setRtRefreshing(false);
      }
    }
  }, [onConnectionProblem]);

  const loadSummary = useCallback(async () => {
    sumAbort.current?.abort();
    const ctl = new AbortController();
    sumAbort.current = ctl;
    setSumRefreshing(true);
    try {
      const s = await getGaSummary(days, ctl.signal);
      if (ctl.signal.aborted) return;
      const err = s.error ?? (s.connected ? undefined : { code: 'not_connected', message: gaErrorMessage('not_connected') });
      // A transient error can come with the last good (cached) data: show it.
      if (!err || s.cached) setSummary(s);
      setSumError(err ?? null);
      if (err && isConnectionError(err.code)) onConnectionProblem();
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) return;
      const err = toGaError(e, 'Could not load website traffic summary');
      setSumError(err);
      if (isConnectionError(err.code)) onConnectionProblem();
    } finally {
      if (!ctl.signal.aborted) {
        setSumLoading(false);
        setSumRefreshing(false);
      }
    }
  }, [days, onConnectionProblem]);

  usePolling(loadRealtime, REALTIME_INTERVAL_MS);
  usePolling(loadSummary, SUMMARY_INTERVAL_MS, true, days);

  // Abort anything in flight when the card goes away.
  useEffect(() => {
    return () => {
      rtAbort.current?.abort();
      sumAbort.current?.abort();
    };
  }, []);

  const refreshAll = () => {
    void loadRealtime();
    void loadSummary();
  };

  // A different range keeps the old numbers on screen while the new ones load.
  const changeDays = (d: GaSummaryDays) => {
    if (d === days) return;
    setDays(d);
  };

  const propertyLabel = status.property_name || `Property ${status.property_id}`;
  const isLive = !!realtime && !rtError;
  // When both calls fail for the same reason before any data arrived, one
  // explanation is enough (e.g. the Analytics APIs are not enabled).
  const sameBlockingError =
    !realtime && !summary && !!rtError && !!sumError && rtError.code === sumError.code;

  return (
    <section aria-labelledby="ga-live-heading">
      {/* Section header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="ga-live-heading" className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Website live
            {isLive && <LiveDot />}
          </h2>
          <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-1.5 min-w-0">
            <span className="font-medium text-gray-600 truncate max-w-full" title={propertyLabel}>
              {propertyLabel}
            </span>
            {realtime?.fetched_at && (
              <>
                <span aria-hidden="true">·</span>
                <UpdatedAgo iso={realtime.fetched_at} />
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Link
              to={GA_SETTINGS_PATH}
              className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm text-gray-600"
              aria-label="Google Analytics settings"
              title="Google Analytics settings"
            >
              <Settings2 className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={refreshAll}
            disabled={rtRefreshing}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm text-gray-700 disabled:opacity-70"
            aria-label="Refresh website stats"
          >
            <RefreshCw className={`h-4 w-4 ${rtRefreshing ? 'animate-spin' : ''}`} />
            <span className="font-medium text-sm hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Last 28 days at a glance + link to the full page (useful when nobody is on the site right now) */}
      <WebsiteSummaryRow />

      {/* Realtime */}
      {rtLoading && !realtime ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SkeletonBlock className="h-56" />
            <SkeletonBlock className="h-56 lg:col-span-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonBlock className="h-48" />
            <SkeletonBlock className="h-48" />
            <SkeletonBlock className="h-48" />
          </div>
        </div>
      ) : !realtime ? (
        rtError ? <GaErrorState error={rtError} canManage={canManage} onRetry={() => void loadRealtime()} /> : null
      ) : (
        <RealtimeBody realtime={realtime} error={rtError} />
      )}

      {/* Email campaigns */}
      {!sameBlockingError && (
        <EmailCampaignsPanel
          summary={summary}
          error={sumError}
          loading={sumLoading}
          refreshing={sumRefreshing && !!summary}
          days={days}
          onDaysChange={changeDays}
          highlightSource={status.highlight_source}
          canManage={canManage}
          onRetry={() => void loadSummary()}
        />
      )}
    </section>
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Realtime body
// ---------------------------------------------------------------------------

const DEVICE_ICONS: Record<string, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  'smart tv': Tv,
};

function RealtimeBody({ realtime, error }: { realtime: GaRealtime; error: GaError | null }) {
  const peak = Math.max(0, ...realtime.per_minute.map((m) => m.users));
  const deviceTotal = realtime.devices.reduce((sum, d) => sum + d.users, 0);

  return (
    <div className="space-y-4">
      {error && <StaleWarning error={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active users now */}
        <motion.div
          className="relative overflow-hidden rounded-2xl shadow-lg p-6 text-white bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="relative h-full flex flex-col">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
              <span className="relative inline-flex h-3 w-3" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
              Active users · last 30 min
            </div>
            <p className="mt-3 text-6xl font-extrabold tracking-tight tabular-nums leading-none">
              {fmtNum(realtime.active_users)}
            </p>
            <p className="mt-2 text-sm text-white/80">On your website, live from Google Analytics</p>
            <div className="mt-5 lg:mt-auto lg:pt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-white/75 font-semibold">Peak minute</p>
                <p className="text-lg font-bold tabular-nums">{fmtNum(peak)}</p>
              </div>
              <div className="rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-white/75 font-semibold">This minute</p>
                <p className="text-lg font-bold tabular-nums">{fmtNum(realtime.per_minute[0]?.users ?? 0)}</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Per-minute chart */}
        <WidgetCard
          title="Users per minute"
          icon={BarChart3}
          color="purple"
          subtitle="Last 30 minutes"
          className="lg:col-span-2"
          delay={0.05}
        >
          <PerMinuteChart data={realtime.per_minute} />
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <WidgetCard title="Top pages" subtitle="By page title" icon={FileText} color="purple" delay={0.1}>
          <RankedList
            items={toRanked(realtime.top_pages)}
            color="purple"
            empty="No page views in the last 30 minutes"
            valueLabel="users"
          />
        </WidgetCard>
        <WidgetCard title="Top countries" icon={Globe} color="blue" delay={0.15}>
          <RankedList
            items={toRanked(realtime.countries)}
            color="blue"
            empty="No visitors in the last 30 minutes"
            valueLabel="users"
          />
        </WidgetCard>
        <WidgetCard title="Devices" icon={Monitor} color="orange" delay={0.2}>
          <RankedList
            items={realtime.devices.map((d) => {
              const share = sharePct(d.users, deviceTotal);
              return {
                key: d.name,
                label: capitalize(d.name),
                value: d.users,
                icon: DEVICE_ICONS[d.name.toLowerCase()] ?? Globe,
                suffix: share !== null ? `${share}%` : undefined,
              };
            })}
            color="orange"
            empty="No visitors in the last 30 minutes"
            valueLabel="users"
          />
        </WidgetCard>
      </div>
    </div>
  );
}

function toRanked(list: GaNamedCount[]) {
  return [...list]
    .sort((a, b) => b.users - a.users)
    .map((i, idx) => ({ key: `${i.name}-${idx}`, label: i.name, value: i.users }));
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function minuteLabel(minutesAgo: number): string {
  if (minutesAgo === 0) return 'This minute';
  return minutesAgo === 1 ? '1 minute ago' : `${minutesAgo} minutes ago`;
}

function PerMinuteChart({ data }: { data: GaMinute[] }) {
  // Oldest on the left, "now" on the right.
  const series = [...data].sort((a, b) => b.minutes_ago - a.minutes_ago);
  const peak = Math.max(0, ...series.map((d) => d.users));
  return (
    <div
      className="h-[200px]"
      role="img"
      aria-label={`Active users per minute over the last 30 minutes. Peak ${peak}, this minute ${
        data.find((d) => d.minutes_ago === 0)?.users ?? 0
      }.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
          <defs>
            <linearGradient id="gaPerMinuteBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="minutes_ago"
            interval={0}
            tickFormatter={(v) => {
              const m = Number(v);
              if (m === 0) return 'now';
              return m % 5 === 0 ? `-${m}m` : '';
            }}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            cursor={{ fill: 'rgba(139, 92, 246, 0.08)' }}
            contentStyle={{
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              fontSize: 12,
            }}
            labelFormatter={(v) => minuteLabel(Number(v))}
            formatter={(value) => [fmtNum(Number(value)), 'Active users']}
          />
          <Bar dataKey="users" radius={[4, 4, 0, 0]} animationDuration={400}>
            {series.map((d) => (
              <Cell key={d.minutes_ago} fill={d.minutes_ago === 0 ? '#f97316' : 'url(#gaPerMinuteBar)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
