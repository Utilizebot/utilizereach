/**
 * Shared building blocks for the Google Analytics dashboard widgets
 * (same colourful card language as pages/Dashboard.tsx).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Gauge,
  KeyRound,
  PlugZap,
  RefreshCw,
  SearchX,
  ShieldAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { GA_SETTINGS_PATH, gaErrorMessage, type GaError } from '../../lib/googleAnalytics';
import { agoText, fmtNum, parseIso } from './gaFormat';

// ---------------------------------------------------------------------------
// Colour palette (purple / blue / orange family used across the dashboard)
// ---------------------------------------------------------------------------

export type WidgetColor = 'purple' | 'blue' | 'orange' | 'emerald' | 'pink';

const WIDGET_COLORS: Record<WidgetColor, { chip: string; bar: string; text: string }> = {
  purple: { chip: 'from-purple-500 to-violet-600', bar: 'bg-purple-100', text: 'text-purple-700' },
  blue: { chip: 'from-blue-500 to-indigo-600', bar: 'bg-blue-100', text: 'text-blue-700' },
  orange: { chip: 'from-orange-500 to-amber-500', bar: 'bg-orange-100', text: 'text-orange-700' },
  emerald: { chip: 'from-emerald-500 to-teal-600', bar: 'bg-emerald-100', text: 'text-emerald-700' },
  pink: { chip: 'from-pink-500 to-rose-500', bar: 'bg-pink-100', text: 'text-pink-700' },
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

interface WidgetCardProps {
  title: string;
  icon: LucideIcon;
  color?: WidgetColor;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  delay?: number;
  children: React.ReactNode;
}

/** White card with a gradient icon chip header (mirrors Dashboard ChartCard). */
export function WidgetCard({
  title,
  icon: Icon,
  color = 'blue',
  subtitle,
  action,
  className = '',
  delay = 0,
  children,
}: WidgetCardProps) {
  return (
    <motion.div
      className={`bg-white rounded-2xl shadow-lg border border-gray-200 p-5 hover:shadow-xl transition-shadow min-w-0 ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="flex items-start gap-2 mb-4">
        <div
          className={`h-8 w-8 bg-gradient-to-br ${WIDGET_COLORS[color].chip} rounded-lg flex items-center justify-center flex-shrink-0`}
        >
          <Icon className="text-white" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-gray-900 leading-8 truncate">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 -mt-1 truncate">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </motion.div>
  );
}

export interface RankedItem {
  key: string;
  label: string;
  value: number;
  icon?: LucideIcon;
  /** Shown after the value, e.g. "42%". */
  suffix?: string;
}

/** Ranked rows with a proportional background bar. */
export function RankedList({
  items,
  color,
  empty,
  max = 6,
  valueLabel,
}: {
  items: RankedItem[];
  color: WidgetColor;
  empty: string;
  max?: number;
  valueLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>;
  }
  const shown = items.slice(0, max);
  const top = Math.max(...shown.map((i) => i.value), 1);
  return (
    <ul className="space-y-1.5">
      {shown.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.key} className="relative rounded-lg overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${WIDGET_COLORS[color].bar} rounded-lg transition-[width] duration-500`}
              style={{ width: `${Math.max(4, (item.value / top) * 100)}%` }}
              aria-hidden="true"
            />
            <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm">
              {Icon && <Icon size={14} className={`${WIDGET_COLORS[color].text} flex-shrink-0`} />}
              <span className="truncate text-gray-700 flex-1 min-w-0" title={item.label}>
                {item.label}
              </span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {fmtNum(item.value)}
                {valueLabel && <span className="sr-only"> {valueLabel}</span>}
              </span>
              {item.suffix && <span className="text-xs text-gray-500 tabular-nums w-9 text-right">{item.suffix}</span>}
            </div>
          </li>
        );
      })}
      {items.length > max && (
        <li className="text-xs text-gray-400 px-3 pt-1">+{items.length - max} more</li>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// "updated Xs ago"
// ---------------------------------------------------------------------------

export function UpdatedAgo({ iso }: { iso: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 5000);
    return () => window.clearInterval(t);
  }, []);
  // Re-anchor "now" whenever a fresh timestamp arrives.
  useEffect(() => {
    setNow(Date.now());
  }, [iso]);

  const ts = parseIso(iso);
  if (ts === null) return null;
  return (
    <time dateTime={new Date(ts).toISOString()} title={new Date(ts).toLocaleString()}>
      updated {agoText(ts, now)}
    </time>
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface ErrorCopy {
  icon: LucideIcon;
  title: string;
  /** Show the Settings > Integrations link (to users who can manage). */
  settingsLink: boolean;
  /** The data refreshes on its own (no retry button needed). */
  autoRetry: boolean;
}

function errorCopy(code: string): ErrorCopy {
  switch (code) {
    case 'api_disabled':
      return { icon: PlugZap, title: 'Google Analytics API not enabled', settingsLink: false, autoRetry: false };
    case 'reconnect_required':
    case 'not_connected':
      return { icon: KeyRound, title: 'Google Analytics needs to be reconnected', settingsLink: true, autoRetry: false };
    case 'permission_denied':
      return { icon: ShieldAlert, title: 'No access to this property', settingsLink: true, autoRetry: false };
    case 'invalid_property':
      return { icon: SearchX, title: 'Property not found', settingsLink: true, autoRetry: false };
    case 'quota_exceeded':
      return { icon: Gauge, title: 'Google Analytics rate limit reached', settingsLink: false, autoRetry: true };
    case 'not_configured':
      return { icon: PlugZap, title: 'Google sign-in is not configured', settingsLink: false, autoRetry: false };
    default:
      return { icon: WifiOff, title: 'Could not reach Google Analytics', settingsLink: false, autoRetry: true };
  }
}

/** Full error state shown in place of a widget that has no data yet. */
export function GaErrorState({
  error,
  canManage,
  onRetry,
}: {
  error: GaError;
  canManage: boolean;
  onRetry?: () => void;
}) {
  const copy = errorCopy(error.code);
  const Icon = copy.icon;
  let message = error.message || gaErrorMessage(error.code);
  if (error.code === 'api_disabled' && !canManage) {
    message =
      'Live website stats are unavailable until an admin enables "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud Console.';
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md flex-shrink-0">
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900">{copy.title}</p>
        <p className="text-sm text-gray-600 mt-0.5">{message}</p>
        {copy.autoRetry && <p className="text-xs text-gray-500 mt-1">Retrying automatically.</p>}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {copy.settingsLink && canManage && (
          <Link
            to={GA_SETTINGS_PATH}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg transition-all"
          >
            Open Integrations
          </Link>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 shadow-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw size={14} /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

/** One-line warning shown above data that could not be refreshed. */
export function StaleWarning({ error }: { error: GaError }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 mb-3">
      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
      <span>
        Showing the last data we have. {error.message || gaErrorMessage(error.code)}
      </span>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`rounded-2xl bg-gray-100 animate-pulse ${className}`} aria-hidden="true" />;
}
