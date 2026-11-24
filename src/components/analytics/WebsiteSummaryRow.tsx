/**
 * Compact "last 28 days" row for the Dashboard's Website live card, so the
 * card is useful even when nobody is on the site right now (realtime 0):
 * visitors, visits, page views, the top 3 countries, and a link to the full
 * Website analytics page. Loads /report?days=28 (polled every 5 min).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, Globe, Route, Users, type LucideIcon } from 'lucide-react';
import { usePolling } from '../../hooks/usePolling';
import { fetchReport, isAbortError, type GaReport } from '../../lib/googleAnalytics';
import { countryFlag } from './countryFlag';
import { fmtNum } from './gaFormat';
import { SkeletonBlock } from './gaWidgets';

const SUMMARY_DAYS = 28;
const INTERVAL_MS = 5 * 60_000;
export const WEBSITE_ANALYTICS_PATH = '/website-analytics';

export function WebsiteSummaryRow() {
  const [report, setReport] = useState<GaReport | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const r = await fetchReport(SUMMARY_DAYS, ctl.signal);
      if (ctl.signal.aborted) return;
      // Keep the last good numbers when a refresh fails without cached data.
      if (!r.error || r.cached) setReport(r);
    } catch (e) {
      if (isAbortError(e) || ctl.signal.aborted) return;
      /* the full page explains errors; the row just keeps what it has */
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  usePolling(load, INTERVAL_MS);

  useEffect(() => () => abortRef.current?.abort(), []);

  const link = (
    <Link
      to={WEBSITE_ANALYTICS_PATH}
      className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
    >
      View full website analytics <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );

  if (loading && !report) return <SkeletonBlock className="h-20 mb-4" />;

  if (!report) {
    return <div className="flex justify-end mb-4">{link}</div>;
  }

  const t = report.totals;
  const topCountries = [...report.countries].sort((a, b) => b.users - a.users).slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 bg-white rounded-2xl shadow-lg border border-gray-200 p-4 flex flex-col gap-3 lg:flex-row lg:items-center"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 lg:w-24 flex-shrink-0">
        Last {SUMMARY_DAYS} days
      </p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 flex-1 min-w-0">
        <Stat icon={Users} label="Visitors" value={t.users} gradient="from-blue-500 to-indigo-600" />
        <Stat icon={Route} label="Visits" value={t.sessions} gradient="from-purple-500 to-violet-600" />
        <Stat icon={Eye} label="Page views" value={t.page_views} gradient="from-orange-500 to-amber-500" />
      </div>
      <div className="min-w-0 lg:w-64 flex-shrink-0">
        <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mb-1">
          <Globe size={12} aria-hidden="true" /> Top countries
        </p>
        {topCountries.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {topCountries.map((c) => (
              <li
                key={c.country}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 text-xs font-medium max-w-full"
              >
                <span className="truncate">{`${countryFlag(c.country)} ${c.country}`.trim()}</span>
                <span className="font-bold tabular-nums">{fmtNum(c.users)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No visits yet</p>
        )}
      </div>
      <div className="flex-shrink-0">{link}</div>
    </motion.div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  gradient: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className={`h-8 w-8 bg-gradient-to-br ${gradient} rounded-lg items-center justify-center shadow-sm flex-shrink-0 hidden sm:flex`}
      >
        <Icon size={15} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums leading-tight">{fmtNum(value)}</p>
        <p className="text-[11px] sm:text-xs text-gray-500 truncate">{label}</p>
      </div>
    </div>
  );
}
