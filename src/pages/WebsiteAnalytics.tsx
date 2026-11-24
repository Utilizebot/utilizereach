/**
 * Website analytics - everything important from the brand's Google Analytics 4
 * property in one page (so nobody needs to open Google Analytics), next to
 * UtilizeReach's own email open / click tracking.
 *
 * Data:
 *   GET /api/integrations/google-analytics/status         connection + property
 *   GET /api/integrations/google-analytics/report?days=N  the report (polled 5 min)
 *   GET /api/integrations/google-analytics/realtime       the LIVE strip (polled 30 s)
 *
 * The email tracking half of the report comes from UtilizeReach's own database,
 * so it is shown even when Google Analytics is not connected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock,
  Compass,
  Eye,
  FileText,
  Globe,
  Info,
  KeyRound,
  Laptop,
  Mail,
  MapPin,
  Megaphone,
  Monitor,
  MousePointerClick,
  RefreshCw,
  Repeat,
  Route,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePolling';
import {
  GA_REPORT_DAYS,
  GA_SETTINGS_PATH,
  GaApiError,
  fetchReport,
  gaErrorMessage,
  getGaRealtime,
  getGaStatus,
  isAbortError,
  isConnectionError,
  type GaError,
  type GaRealtime,
  type GaReport,
  type GaReportDays,
  type GaReportTotals,
  type GaStatus,
} from '../lib/googleAnalytics';
import { countryFlag } from '../components/analytics/countryFlag';
import {
  engagementPct,
  fmtDuration,
  fmtNum,
  pctChange,
  prettifyCampaign,
  prettifyPersona,
  ratePct,
  sharePct,
  shortDate,
} from '../components/analytics/gaFormat';
import {
  GaErrorState,
  RankedList,
  SkeletonBlock,
  StaleWarning,
  UpdatedAgo,
  WidgetCard,
  type WidgetColor,
} from '../components/analytics/gaWidgets';

const REPORT_INTERVAL_MS = 5 * 60_000;
const REALTIME_INTERVAL_MS = 30_000;
const STATUS_RECHECK_MS = 60_000;
const DAYS_KEY = 'utilizereach.website_analytics_days';
const DEFAULT_DAYS: GaReportDays = 28;

const CHART_COLORS = ['#8b5cf6', '#f97316', '#3b82f6', '#10b981', '#ec4899', '#f59e0b', '#6366f1', '#14b8a6'];

const TOOLTIP_STYLE = {
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  fontSize: 12,
};

const GAP_SENTENCE =
  "Google Analytics only counts visitors who accept your website's cookie banner, so UtilizeReach's own click counts are usually higher.";

function readDays(): GaReportDays {
  try {
    const v = Number(localStorage.getItem(DAYS_KEY));
    return (GA_REPORT_DAYS as readonly number[]).includes(v) ? (v as GaReportDays) : DEFAULT_DAYS;
  } catch {
    return DEFAULT_DAYS;
  }
}

function writeDays(days: GaReportDays): void {
  try {
    localStorage.setItem(DAYS_KEY, String(days));
  } catch {
    /* storage unavailable - remembered for this visit only */
  }
}

function toGaError(e: unknown, fallback: string): GaError {
  const code = e instanceof GaApiError && e.code ? e.code : 'upstream_error';
  const message = e instanceof Error && e.message ? e.message : gaErrorMessage(code, fallback);
  return { code, message };
}

/** Why the Google Analytics half of the page cannot show data (or 'connected'). */
type GaView =
  | 'loading'
  | 'not_configured'
  | 'not_connected'
  | 'reconnect_required'
  | 'no_property'
  | 'hidden'
  | 'connected';

function gaView(status: GaStatus | null, statusDone: boolean, report: GaReport | null, canManage: boolean): GaView {
  if (!status) {
    // /status still loading: a clean report already proves the connection.
    if (!statusDone) return report?.connected && !report.error ? 'connected' : 'loading';
    // /status failed: trust the report.
    return report?.connected ? 'connected' : 'not_connected';
  }
  if (!status.configured && !status.connected) return 'not_configured';
  if (status.status === 'reconnect_required') return 'reconnect_required';
  if (status.status !== 'connected') return 'not_connected';
  if (!status.property_id) return 'no_property';
  if (!status.show_on_dashboard && !canManage) return 'hidden';
  return 'connected';
}

// ===========================================================================
// Page
// ===========================================================================

export function WebsiteAnalytics() {
  const { can } = useAuth();
  const canManage = can('settings.manage');

  const [days, setDays] = useState<GaReportDays>(readDays);

  const [status, setStatus] = useState<GaStatus | null>(null);
  const [statusDone, setStatusDone] = useState(false);

  const [report, setReport] = useState<GaReport | null>(null);
  const [reportError, setReportError] = useState<GaError | null>(null);
  const [fatalError, setFatalError] = useState<GaError | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [realtime, setRealtime] = useState<GaRealtime | null>(null);
  const [rtError, setRtError] = useState<GaError | null>(null);

  const statusAbort = useRef<AbortController | null>(null);
  const reportAbort = useRef<AbortController | null>(null);
  const rtAbort = useRef<AbortController | null>(null);
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
      /* fall back to what the report says */
    } finally {
      if (!ctl.signal.aborted) setStatusDone(true);
    }
  }, []);

  const recheckStatus = useCallback(() => {
    if (Date.now() - lastStatusCheck.current < STATUS_RECHECK_MS) return;
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const loadReport = useCallback(async () => {
    reportAbort.current?.abort();
    const ctl = new AbortController();
    reportAbort.current = ctl;
    setRefreshing(true);
    try {
      const r = await fetchReport(days, ctl.signal);
      if (ctl.signal.aborted) return;
      setReport(r);
      setFatalError(null);
      setReportError(r.error ?? null);
      if (r.error && isConnectionError(r.error.code)) recheckStatus();
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) return;
      setFatalError(toGaError(e, 'Could not load website analytics'));
    } finally {
      if (!ctl.signal.aborted) {
        setReportLoading(false);
        setRefreshing(false);
      }
    }
  }, [days, recheckStatus]);

  const view = gaView(status, statusDone, report, canManage);
  const liveEnabled = view === 'connected';

  const loadRealtime = useCallback(async () => {
    rtAbort.current?.abort();
    const ctl = new AbortController();
    rtAbort.current = ctl;
    try {
      const r = await getGaRealtime(ctl.signal);
      if (ctl.signal.aborted) return;
      if (!r.error || r.cached) setRealtime(r);
      setRtError(r.error ?? null);
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) return;
      setRtError(toGaError(e, 'Could not load live visitors'));
    }
  }, []);

  usePolling(loadReport, REPORT_INTERVAL_MS, true, days);
  usePolling(loadRealtime, REALTIME_INTERVAL_MS, liveEnabled);

  useEffect(() => {
    return () => {
      statusAbort.current?.abort();
      reportAbort.current?.abort();
      rtAbort.current?.abort();
    };
  }, []);

  const changeDays = (d: GaReportDays) => {
    if (d === days) return;
    writeDays(d);
    setDays(d);
  };

  const refreshAll = () => {
    void loadReport();
    if (liveEnabled) void loadRealtime();
  };

  const propertyLabel =
    status?.property_name ||
    report?.property_name ||
    (status?.property_id || report?.property_id ? `Property ${status?.property_id || report?.property_id}` : null);

  // GA data is usable when there is no error, or the error came with cached data.
  const hasGaData = !!report && view === 'connected' && (!reportError || report.cached);
  const stale = report && report.days !== days;
  // Labels follow the report on screen, not the range still loading.
  const shownDays: GaReportDays = (GA_REPORT_DAYS as readonly number[]).includes(report?.days ?? 0)
    ? (report!.days as GaReportDays)
    : days;
  const highlightSource = report?.highlight_source ?? status?.highlight_source ?? null;

  return (
    <div className="max-w-7xl mx-auto space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 w-12 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0">
            <Globe className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Website analytics</h1>
            <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-1.5 min-w-0">
              {propertyLabel ? (
                <span className="font-medium text-gray-600 truncate max-w-full" title={propertyLabel}>
                  {propertyLabel}
                </span>
              ) : (
                <span>Google Analytics + UtilizeReach email tracking</span>
              )}
              {report?.range && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {shortDate(report.range.start)} – {shortDate(report.range.end)}
                  </span>
                </>
              )}
              {report?.fetched_at && (
                <>
                  <span aria-hidden="true">·</span>
                  <UpdatedAgo iso={report.fetched_at} />
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeSelector days={days} onChange={changeDays} />
          {canManage && (
            <Link
              to={GA_SETTINGS_PATH}
              className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm text-gray-600"
              aria-label="Google Analytics settings"
              title="Google Analytics settings"
            >
              <Settings2 className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm text-gray-700 disabled:opacity-70"
            aria-label="Refresh website analytics"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="font-medium text-sm hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* LIVE strip */}
      {liveEnabled && <LiveStrip realtime={realtime} error={rtError} />}

      {/* Whole report failed (network / server) */}
      {fatalError && !report && (
        <GaErrorState error={fatalError} canManage={canManage} onRetry={() => void loadReport()} />
      )}

      {/* Google Analytics part */}
      {reportLoading && !report && !fatalError ? (
        <PageSkeleton />
      ) : (
        <div className={`space-y-6 transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={!!stale}>
          {view !== 'connected' && view !== 'loading' && <GaStateCard view={view} canManage={canManage} />}

          {view === 'connected' && report && reportError && !hasGaData && (
            <GaErrorState error={reportError} canManage={canManage} onRetry={() => void loadReport()} />
          )}

          {hasGaData && report && (
            <>
              {reportError && <StaleWarning error={reportError} />}
              <GaSections report={report} days={shownDays} />
            </>
          )}

          {report && (
            <EmailOutreach
              report={report}
              days={shownDays}
              gaReady={hasGaData}
              view={view}
              highlightSource={highlightSource}
              canManage={canManage}
            />
          )}

          {report && report.notes.length > 0 && (
            <ul className="space-y-1 text-xs text-gray-500">
              {report.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <Info size={12} className="flex-shrink-0 mt-0.5" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Header pieces
// ===========================================================================

function RangeSelector({ days, onChange }: { days: GaReportDays; onChange: (d: GaReportDays) => void }) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center rounded-xl bg-white border border-gray-200 shadow-sm p-1"
    >
      <CalendarDays size={14} className="text-gray-400 mx-1.5" aria-hidden="true" />
      {GA_REPORT_DAYS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={d === days}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            d === days
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}

function LiveStrip({ realtime, error }: { realtime: GaRealtime | null; error: GaError | null }) {
  if (!realtime) {
    if (!error) return <SkeletonBlock className="h-14" />;
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
        <Zap size={16} className="text-gray-400" />
        Live visitors are unavailable right now.
      </div>
    );
  }
  const topPage = [...realtime.top_pages].sort((a, b) => b.users - a.users)[0];
  const topCountry = [...realtime.countries].sort((a, b) => b.users - a.users)[0];
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl shadow-md bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 text-white px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1"
    >
      <div className="flex items-center gap-2">
        <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="text-xs font-bold tracking-widest">LIVE</span>
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold tabular-nums leading-none">{fmtNum(realtime.active_users)}</span>
        <span className="text-sm text-white/90">
          {realtime.active_users === 1 ? 'person' : 'people'} on your website in the last 30 minutes
        </span>
      </p>
      {topPage && realtime.active_users > 0 && (
        <p className="text-xs text-white/85 min-w-0 truncate max-w-full sm:max-w-xs" title={topPage.name}>
          Top page: <span className="font-semibold">{topPage.name}</span>
        </p>
      )}
      {topCountry && realtime.active_users > 0 && (
        <p className="text-xs text-white/85">
          From: <span className="font-semibold">{`${countryFlag(topCountry.name)} ${topCountry.name}`.trim()}</span>
        </p>
      )}
      {error && <p className="text-xs text-white/80 w-full sm:w-auto">(showing the last live data we have)</p>}
    </motion.div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading website analytics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonBlock key={i} className="h-28" />
        ))}
      </div>
      <SkeletonBlock className="h-72" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonBlock className="h-80" />
        <SkeletonBlock className="h-80" />
      </div>
    </div>
  );
}

// ===========================================================================
// Not connected / not configured / hidden
// ===========================================================================

function GaStateCard({ view, canManage }: { view: GaView; canManage: boolean }) {
  if (view === 'not_configured') {
    return (
      <GaErrorState error={{ code: 'not_configured', message: gaErrorMessage('not_configured') }} canManage={canManage} />
    );
  }
  if (view === 'reconnect_required') {
    return (
      <GaErrorState
        error={{ code: 'reconnect_required', message: gaErrorMessage('reconnect_required') }}
        canManage={canManage}
      />
    );
  }
  let title = 'Connect Google Analytics';
  let text = 'See visits, countries, pages, traffic sources and devices for your website right here.';
  let action = 'Connect';
  if (view === 'no_property') {
    title = 'Choose your website';
    text = 'Google Analytics is connected. Pick the property of your website to see its numbers here.';
    action = 'Choose property';
  } else if (view === 'hidden') {
    title = 'Website analytics are switched off';
    text = 'A brand admin can switch them on in Settings > Integrations.';
  }
  if (!canManage && view !== 'hidden') {
    text += ' Ask a brand admin to set it up in Settings > Integrations.';
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-purple-50 p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm"
    >
      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-md flex-shrink-0">
        {view === 'hidden' ? <KeyRound className="h-5 w-5 text-white" /> : <BarChart3 className="h-5 w-5 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900">{title}</p>
        <p className="text-sm text-gray-600 mt-0.5">{text}</p>
        <p className="text-xs text-gray-500 mt-1">Your email tracking below works without it.</p>
      </div>
      {canManage && view !== 'hidden' && (
        <Link
          to={GA_SETTINGS_PATH}
          className="self-start sm:self-auto px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg transition-all whitespace-nowrap"
        >
          {action}
        </Link>
      )}
    </motion.div>
  );
}

// ===========================================================================
// Google Analytics sections
// ===========================================================================

function GaSections({ report, days }: { report: GaReport; days: number }) {
  const t = report.totals;
  const empty = t.users === 0 && t.sessions === 0 && t.page_views === 0;

  return (
    <>
      <KpiGrid totals={t} previous={report.previous} days={days} />

      {empty ? (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-md">
            <Compass className="h-6 w-6 text-white" />
          </div>
          <p className="mt-3 font-semibold text-gray-900">No visits in this period</p>
          <p className="text-sm text-gray-500 mt-1">Try a longer range, or check back once people visit your website.</p>
        </div>
      ) : (
        <>
          <WidgetCard
            title="Visitors over time"
            subtitle={`Daily, last ${days} days`}
            icon={TrendingUp}
            color="purple"
          >
            <TrendChart data={report.daily} />
          </WidgetCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WidgetCard title="Countries" subtitle="Visitors by country" icon={Globe} color="blue" delay={0.05}>
              <RankedList
                items={report.countries.map((c, i) => ({
                  key: `${c.country}-${i}`,
                  label: `${countryFlag(c.country)} ${c.country}`.trim(),
                  value: c.users,
                  suffix: c.sessions ? `${fmtNum(c.sessions)} visits` : undefined,
                }))}
                color="blue"
                max={15}
                empty="No country data"
                valueLabel="visitors"
              />
            </WidgetCard>
            <WidgetCard title="Cities" subtitle="Top 10 by visitors" icon={MapPin} color="emerald" delay={0.1}>
              <RankedList
                items={report.cities.map((c, i) => ({
                  key: `${c.city}-${c.country}-${i}`,
                  label: c.country ? `${countryFlag(c.country)} ${c.city}, ${c.country}`.trim() : c.city,
                  value: c.users,
                }))}
                color="emerald"
                max={10}
                empty="No city data"
                valueLabel="visitors"
              />
            </WidgetCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WidgetCard title="Traffic channels" subtitle="How people found you (visits)" icon={Share2} color="orange">
              <Donut
                data={report.channels.map((c) => ({ name: c.channel, value: c.sessions }))}
                unit="visits"
                empty="No channel data"
              />
            </WidgetCard>
            <WidgetCard title="Sources" subtitle="Top 10 source / medium" icon={Route} color="purple" delay={0.05}>
              <SourcesTable rows={report.sources} />
            </WidgetCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <WidgetCard title="Top pages" subtitle="Top 10 by page views" icon={FileText} color="blue" className="lg:col-span-2">
              <PagesTable rows={report.pages} />
            </WidgetCard>
            <WidgetCard title="Landing pages" subtitle="Where visits start" icon={Target} color="pink" delay={0.05}>
              <RankedList
                items={report.landing_pages.map((p, i) => ({ key: `${p.page}-${i}`, label: p.page, value: p.sessions }))}
                color="pink"
                max={10}
                empty="No landing page data"
                valueLabel="visits"
              />
            </WidgetCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <WidgetCard title="Devices" icon={Monitor} color="orange">
              <Donut
                data={report.devices.map((d) => ({ name: capitalize(d.device), value: d.users }))}
                unit="visitors"
                empty="No device data"
                compact
              />
            </WidgetCard>
            <WidgetCard title="New vs returning" icon={Repeat} color="emerald" delay={0.05}>
              <NewVsReturning rows={report.new_vs_returning} />
            </WidgetCard>
            <WidgetCard title="Browsers" icon={Compass} color="blue" delay={0.1}>
              <RankedList
                items={withShare(report.browsers.map((b) => ({ label: b.browser, value: b.users })), report.totals.users)}
                color="blue"
                empty="No browser data"
                valueLabel="visitors"
              />
            </WidgetCard>
            <WidgetCard title="Operating systems" icon={Laptop} color="purple" delay={0.15}>
              <RankedList
                items={withShare(report.os.map((o) => ({ label: o.os, value: o.users })), report.totals.users)}
                color="purple"
                empty="No operating system data"
                valueLabel="visitors"
              />
            </WidgetCard>
          </div>

          <WidgetCard
            title="Clicks & events"
            subtitle="What visitors did on your website"
            icon={MousePointerClick}
            color="pink"
          >
            <RankedList
              items={report.events.map((e, i) => ({ key: `${e.event}-${i}`, label: eventLabel(e.event), value: e.count }))}
              color="pink"
              max={15}
              empty="No events recorded"
              valueLabel="times"
            />
          </WidgetCard>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

interface KpiDef {
  key: keyof GaReportTotals;
  label: string;
  icon: LucideIcon;
  gradient: string;
  format: (v: number) => string;
  hint?: string;
}

const KPIS: KpiDef[] = [
  { key: 'users', label: 'Visitors', icon: Users, gradient: 'from-blue-500 to-indigo-600', format: fmtNum },
  { key: 'new_users', label: 'New visitors', icon: UserPlus, gradient: 'from-emerald-500 to-teal-600', format: fmtNum },
  { key: 'sessions', label: 'Visits', icon: Route, gradient: 'from-purple-500 to-violet-600', format: fmtNum, hint: 'Sessions' },
  { key: 'page_views', label: 'Page views', icon: Eye, gradient: 'from-orange-500 to-amber-500', format: fmtNum },
  {
    key: 'engagement_rate',
    label: 'Engagement rate',
    icon: Sparkles,
    gradient: 'from-pink-500 to-rose-500',
    format: (v) => `${engagementPct(v)}%`,
    hint: 'Visits longer than 10 s, with 2+ pages or a key event',
  },
  {
    key: 'avg_engagement_seconds',
    label: 'Avg engagement time',
    icon: Clock,
    gradient: 'from-cyan-500 to-blue-600',
    format: fmtDuration,
    hint: 'Per visitor',
  },
  { key: 'events', label: 'Events', icon: MousePointerClick, gradient: 'from-violet-500 to-purple-600', format: fmtNum },
  { key: 'key_events', label: 'Key events', icon: Target, gradient: 'from-amber-500 to-orange-600', format: fmtNum, hint: 'Conversions' },
];

function KpiGrid({ totals, previous, days }: { totals: GaReportTotals; previous: GaReportTotals; days: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {KPIS.map((k, i) => (
        <KpiTile
          key={k.key}
          def={k}
          value={totals[k.key]}
          previous={previous[k.key]}
          days={days}
          delay={i * 0.03}
        />
      ))}
    </div>
  );
}

function KpiTile({
  def,
  value,
  previous,
  days,
  delay,
}: {
  def: KpiDef;
  value: number;
  previous: number;
  days: number;
  delay: number;
}) {
  const Icon = def.icon;
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4 sm:p-5 hover:shadow-xl transition-shadow min-w-0"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      title={def.hint}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs sm:text-sm font-medium text-gray-600 leading-tight">{def.label}</p>
        <div
          className={`h-9 w-9 sm:h-10 sm:w-10 bg-gradient-to-br ${def.gradient} rounded-xl flex items-center justify-center shadow-md flex-shrink-0`}
        >
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <p className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums truncate">{def.format(value)}</p>
      <ChangePill current={value} previous={previous} days={days} />
    </motion.div>
  );
}

function ChangePill({ current, previous, days }: { current: number; previous: number; days: number }) {
  const change = pctChange(current, previous);
  const vs = `vs previous ${days} days`;
  if (change === null) {
    return (
      <p className="mt-1 text-xs text-gray-400" title={`No data for the previous ${days} days`}>
        — <span className="hidden sm:inline">{vs}</span>
      </p>
    );
  }
  const rounded = Math.round(change);
  const up = rounded > 0;
  const down = rounded < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : ArrowRight;
  const tone = up ? 'bg-emerald-50 text-emerald-700' : down ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600';
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-400">
      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${tone}`}>
        <Icon size={12} aria-hidden="true" />
        {up ? '+' : ''}
        {rounded}%
      </span>
      <span className="hidden sm:inline">{vs}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function TrendChart({ data }: { data: GaReport['daily'] }) {
  const users = data.reduce((s, d) => s + d.users, 0);
  const sessions = data.reduce((s, d) => s + d.sessions, 0);
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3 text-xs">
        <LegendDot color="#8b5cf6" label="Visitors" />
        <LegendDot color="#f97316" label="Visits" />
      </div>
      <div
        className="h-[260px]"
        role="img"
        aria-label={`Daily visitors and visits. ${fmtNum(users)} visitor-days and ${fmtNum(sessions)} visits in total.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="waUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="waSessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => shortDate(String(v))}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={32} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(value, name) => [fmtNum(Number(value)), name === 'users' ? 'Visitors' : 'Visits']}
            />
            <Area type="monotone" dataKey="sessions" stroke="#f97316" strokeWidth={2} fill="url(#waSessions)" />
            <Area type="monotone" dataKey="users" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#waUsers)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600 font-medium">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function Donut({
  data,
  unit,
  empty,
  compact = false,
}: {
  data: { name: string; value: number }[];
  unit: string;
  empty: string;
  compact?: boolean;
}) {
  const rows = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, d) => s + d.value, 0);
  if (!rows.length) return <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>;
  return (
    <div className={`flex ${compact ? 'flex-col' : 'flex-col sm:flex-row'} items-center gap-4`}>
      <div className="relative h-[160px] w-[160px] flex-shrink-0" role="img" aria-label={`${fmtNum(total)} ${unit} in total`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75} paddingAngle={2} stroke="none">
              {rows.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [fmtNum(Number(value)), String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-gray-900 tabular-nums">{fmtNum(total)}</span>
          <span className="text-[11px] text-gray-500">{unit}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5">
        {rows.slice(0, 8).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-sm min-w-0">
            <span
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="truncate text-gray-700 flex-1 min-w-0" title={d.name}>
              {d.name}
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{fmtNum(d.value)}</span>
            <span className="text-xs text-gray-500 tabular-nums w-9 text-right">{sharePct(d.value, total) ?? 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewVsReturning({ rows }: { rows: GaReport['new_vs_returning'] }) {
  const fresh = rows.find((r) => r.type === 'new')?.users ?? 0;
  const back = rows.find((r) => r.type === 'returning')?.users ?? 0;
  const total = fresh + back;
  if (!total) return <p className="text-sm text-gray-400 py-6 text-center">No data</p>;
  const freshPct = sharePct(fresh, total) ?? 0;
  return (
    <div className="space-y-4">
      <div className="h-4 w-full rounded-full overflow-hidden bg-gray-100 flex" role="img" aria-label={`${freshPct}% new visitors`}>
        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${freshPct}%` }} />
        <div className="h-full bg-gradient-to-r from-purple-500 to-violet-600 flex-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
            <UserPlus size={12} /> New
          </p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(fresh)}</p>
          <p className="text-xs text-gray-500">{freshPct}%</p>
        </div>
        <div className="rounded-xl bg-purple-50 p-3">
          <p className="text-xs font-semibold text-purple-700 flex items-center gap-1">
            <Repeat size={12} /> Returning
          </p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(back)}</p>
          <p className="text-xs text-gray-500">{100 - freshPct}%</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function SourcesTable({ rows }: { rows: GaReport['sources'] }) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-6 text-center">No source data</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
          <th className="py-2 pr-2 font-semibold">Source / medium</th>
          <th className="py-2 px-1 font-semibold text-right w-16">Visits</th>
          <th className="py-2 pl-1 font-semibold text-right w-16">Visitors</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 10).map((r, i) => (
          <tr key={`${r.source}-${r.medium}-${i}`} className="border-b border-gray-50 last:border-0">
            <td className="py-2 pr-2 min-w-0">
              <p className="truncate text-gray-800 font-medium" title={r.source}>
                {r.source}
              </p>
              <p className="truncate text-xs text-gray-500" title={r.medium}>
                {r.medium}
              </p>
            </td>
            <td className="py-2 px-1 text-right font-semibold text-gray-900 tabular-nums">{fmtNum(r.sessions)}</td>
            <td className="py-2 pl-1 text-right text-gray-600 tabular-nums">{fmtNum(r.users)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PagesTable({ rows }: { rows: GaReport['pages'] }) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-6 text-center">No page data</p>;
  const top = Math.max(1, ...rows.map((r) => r.views));
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
          <th className="py-2 pr-2 font-semibold">Page</th>
          <th className="py-2 px-1 font-semibold text-right w-16">Views</th>
          <th className="py-2 px-1 font-semibold text-right w-16 hidden sm:table-cell">Visitors</th>
          <th className="py-2 pl-1 font-semibold text-right w-20 hidden sm:table-cell">Avg time</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 10).map((r, i) => (
          <tr key={`${r.path}-${i}`} className="border-b border-gray-50 last:border-0">
            <td className="py-2 pr-2 min-w-0">
              <div className="relative">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-blue-50"
                  style={{ width: `${Math.max(3, (r.views / top) * 100)}%` }}
                  aria-hidden="true"
                />
                <div className="relative px-1.5 py-0.5">
                  <p className="truncate font-mono text-xs text-gray-800" title={r.path}>
                    {r.path}
                  </p>
                  {r.title && (
                    <p className="truncate text-xs text-gray-500" title={r.title}>
                      {r.title}
                    </p>
                  )}
                </div>
              </div>
            </td>
            <td className="py-2 px-1 text-right font-semibold text-gray-900 tabular-nums">{fmtNum(r.views)}</td>
            <td className="py-2 px-1 text-right text-gray-600 tabular-nums hidden sm:table-cell">{fmtNum(r.users)}</td>
            <td className="py-2 pl-1 text-right text-gray-600 tabular-nums hidden sm:table-cell">
              {fmtDuration(r.avg_engagement_seconds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ===========================================================================
// Email outreach: UtilizeReach tracking vs what Google Analytics saw
// ===========================================================================

function EmailOutreach({
  report,
  days,
  gaReady,
  view,
  highlightSource,
  canManage,
}: {
  report: GaReport;
  days: number;
  gaReady: boolean;
  view: GaView;
  highlightSource: string | null;
  canManage: boolean;
}) {
  const t = report.email_tracking;
  const g = report.email_ga;
  const openRate = ratePct(t.opened, t.sent);
  const clickRate = ratePct(t.clicked_emails, t.sent);

  return (
    <section aria-labelledby="wa-email-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-pink-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <Mail className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="wa-email-heading" className="text-xl font-bold text-gray-900">
            Email outreach <span className="text-gray-400 font-semibold text-base">(last {days} days)</span>
          </h2>
          <p className="text-xs text-gray-500">How your outreach emails bring people to your website</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 text-sm text-blue-900">
        <Info size={16} className="flex-shrink-0 mt-0.5 text-blue-600" />
        <p>{GAP_SENTENCE}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* UtilizeReach's own tracking */}
        <WidgetCard
          title="UtilizeReach tracking"
          subtitle="Every email sent and every link click"
          icon={Send}
          color="purple"
        >
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <MiniStat label="Sent" value={t.sent} icon={Send} tone="purple" />
            <MiniStat
              label="Opened"
              value={t.opened}
              icon={Eye}
              tone="blue"
              sub={openRate !== null ? `${openRate}% open rate` : undefined}
            />
            <MiniStat
              label="Emails clicked"
              value={t.clicked_emails}
              icon={MousePointerClick}
              tone="orange"
              sub={clickRate !== null ? `${clickRate}% click rate` : undefined}
            />
            <MiniStat label="Total clicks" value={t.total_clicks} icon={Zap} tone="emerald" />
          </div>

          {t.daily.some((d) => d.sent > 0 || d.clicked > 0) && (
            <div className="mt-5">
              <div className="flex flex-wrap gap-4 mb-2 text-xs">
                <LegendDot color="#8b5cf6" label="Sent" />
                <LegendDot color="#f97316" label="Emails clicked" />
              </div>
              <SentVsClickedChart data={t.daily} />
            </div>
          )}

          <SubHeading icon={Megaphone} text="By campaign" />
          <TrackingTable rows={t.by_campaign.map((r) => ({ ...r, name: prettifyCampaign(r.campaign) }))} nameLabel="Campaign" />

          <SubHeading icon={UserRound} text="By sender" />
          <TrackingTable rows={t.by_sender.map((r) => ({ ...r, name: prettifyPersona(r.sender) }))} nameLabel="Sender" />
        </WidgetCard>

        {/* What GA saw */}
        <WidgetCard
          title="What Google Analytics saw"
          subtitle="Website visits that came from your emails"
          icon={BarChart3}
          color="emerald"
          delay={0.05}
        >
          {!gaReady && view === 'loading' ? (
            <div className="space-y-3 py-2" aria-busy="true">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-24" />
            </div>
          ) : !gaReady ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-600">
                {view === 'connected'
                  ? 'Google Analytics data is not available right now.'
                  : 'Connect Google Analytics to see which emails bring visitors to your website.'}
              </p>
              {canManage && view !== 'connected' && view !== 'hidden' && (
                <Link
                  to={GA_SETTINGS_PATH}
                  className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Open Integrations <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <MiniStat label="Visits" value={g.sessions} icon={Route} tone="emerald" />
                <MiniStat label="Visitors" value={g.users} icon={Users} tone="blue" />
                <MiniStat label="Key events" value={g.key_events} icon={Target} tone="orange" />
              </div>
              {highlightSource && (
                <p className="mt-3 text-xs text-gray-500">
                  Visits tagged{' '}
                  <code className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono break-all">
                    utm_source={highlightSource}
                  </code>
                </p>
              )}
              <p className="mt-3 text-xs text-gray-600 rounded-lg bg-gray-50 px-3 py-2">
                UtilizeReach counted <strong className="tabular-nums">{fmtNum(t.total_clicks)}</strong> clicks; Google
                Analytics saw <strong className="tabular-nums">{fmtNum(g.sessions)}</strong> visits from your emails.
              </p>

              <SubHeading icon={Megaphone} text="Visits by campaign" />
              <RankedList
                items={g.by_campaign.map((r, i) => ({
                  key: `${r.campaign}-${i}`,
                  label: prettifyCampaign(r.campaign),
                  value: r.sessions,
                }))}
                color="emerald"
                max={8}
                empty="No email visits recorded by Google Analytics"
                valueLabel="visits"
              />

              <SubHeading icon={UserRound} text="Visits by sender" />
              <RankedList
                items={g.by_sender.map((r, i) => ({
                  key: `${r.sender}-${i}`,
                  label: prettifyPersona(r.sender),
                  value: r.sessions,
                }))}
                color="orange"
                max={8}
                empty="No email visits recorded by Google Analytics"
                valueLabel="visits"
              />
            </>
          )}
        </WidgetCard>
      </div>
    </section>
  );
}

const MINI_TONES: Record<WidgetColor, string> = {
  purple: 'bg-purple-50 text-purple-700',
  blue: 'bg-blue-50 text-blue-700',
  orange: 'bg-orange-50 text-orange-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  pink: 'bg-pink-50 text-pink-700',
};

function MiniStat({
  label,
  value,
  icon: Icon,
  tone,
  sub,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: WidgetColor;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 sm:p-3 min-w-0 ${MINI_TONES[tone]}`}>
      <p className="text-[11px] sm:text-xs font-semibold flex items-center gap-1 truncate">
        <Icon size={12} className="flex-shrink-0" /> {label}
      </p>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{fmtNum(value)}</p>
      {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
    </div>
  );
}

function SubHeading({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <h4 className="mt-5 mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
      <Icon size={12} /> {text}
    </h4>
  );
}

function TrackingTable({
  rows,
  nameLabel,
}: {
  rows: { name: string; sent: number; opened: number; clicked: number }[];
  nameLabel: string;
}) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-3 text-center">No emails sent in this period</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
          <th className="py-1.5 pr-2 font-semibold">{nameLabel}</th>
          <th className="py-1.5 px-1 font-semibold text-right w-14">Sent</th>
          <th className="py-1.5 px-1 font-semibold text-right w-16">Opened</th>
          <th className="py-1.5 pl-1 font-semibold text-right w-16">Clicked</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((r, i) => (
          <tr key={`${r.name}-${i}`} className="border-b border-gray-50 last:border-0">
            <td className="py-1.5 pr-2 truncate text-gray-800" title={r.name}>
              {r.name}
            </td>
            <td className="py-1.5 px-1 text-right tabular-nums text-gray-700">{fmtNum(r.sent)}</td>
            <td className="py-1.5 px-1 text-right tabular-nums text-gray-700">{fmtNum(r.opened)}</td>
            <td className="py-1.5 pl-1 text-right tabular-nums font-semibold text-orange-600">{fmtNum(r.clicked)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SentVsClickedChart({ data }: { data: GaReport['email_tracking']['daily'] }) {
  return (
    <div className="h-[180px]" role="img" aria-label="Emails sent and emails clicked per day">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="waSentBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => shortDate(String(v))}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis yAxisId="sent" allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={32} />
          <YAxis
            yAxisId="clicked"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 10, fill: '#f97316' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(v) => shortDate(String(v))}
            formatter={(value, name) => [fmtNum(Number(value)), name === 'sent' ? 'Sent' : 'Emails clicked']}
          />
          <Bar yAxisId="sent" dataKey="sent" fill="url(#waSentBar)" radius={[4, 4, 0, 0]} />
          <Line yAxisId="clicked" type="monotone" dataKey="clicked" stroke="#f97316" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Share of all visitors (`allUsers`), not of the listed top rows only. A visitor
 * can use several browsers, so the row sum is a floor for the total. */
function withShare(rows: { label: string; value: number }[], allUsers: number) {
  const total = Math.max(allUsers, rows.reduce((s, r) => s + r.value, 0));
  return rows.map((r, i) => {
    const share = sharePct(r.value, total);
    return { key: `${r.label}-${i}`, label: r.label, value: r.value, suffix: share !== null ? `${share}%` : undefined };
  });
}

const EVENT_NAMES: Record<string, string> = {
  page_view: 'Page views',
  session_start: 'Visits started',
  first_visit: 'First visits',
  user_engagement: 'Engaged moments',
  scroll: 'Scrolled to the bottom',
  click: 'Clicks to other websites',
  form_start: 'Started a form',
  form_submit: 'Submitted a form',
  file_download: 'File downloads',
  video_start: 'Started a video',
  video_progress: 'Watched part of a video',
  video_complete: 'Finished a video',
  view_search_results: 'Site searches',
  generate_lead: 'Leads',
};

function eventLabel(event: string): string {
  const friendly = EVENT_NAMES[event];
  return friendly ? `${friendly} (${event})` : event;
}
