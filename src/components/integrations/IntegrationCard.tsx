/**
 * IntegrationCard - the shared shell every integration on
 * Settings > Integrations renders inside (gradient icon chip, name,
 * description, status pill, body).
 *
 * Adding an integration = write a panel component that renders
 * <IntegrationCard ...> and register it in pages/Settings/IntegrationsSettings.tsx.
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export type IntegrationTone = 'green' | 'amber' | 'gray' | 'red' | 'blue';

/** Static description of an integration (the registry entry minus its panel). */
export interface IntegrationMeta {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind gradient stops for the icon chip, e.g. "from-orange-500 to-amber-500". */
  gradient: string;
  category?: string;
}

/** Props every integration panel receives from the registry. */
export interface IntegrationPanelProps {
  meta: IntegrationMeta;
  delay?: number;
}

const PILL_TONES: Record<IntegrationTone, { pill: string; dot: string }> = {
  green: { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  amber: { pill: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  gray: { pill: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
  red: { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  blue: { pill: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
};

export function StatusPill({ tone, children }: { tone: IntegrationTone; children: React.ReactNode }) {
  const t = PILL_TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap ${t.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

interface IntegrationCardProps {
  meta: IntegrationMeta;
  status?: React.ReactNode;
  delay?: number;
  children: React.ReactNode;
}

export function IntegrationCard({ meta, status, delay = 0, children }: IntegrationCardProps) {
  const { name, description, icon: Icon, gradient, category } = meta;
  return (
    <motion.section
      className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      aria-label={name}
    >
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start gap-4 border-b border-gray-100 bg-gradient-to-br from-white to-gray-50/60">
        <div
          className={`h-12 w-12 flex-shrink-0 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}
        >
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">{name}</h3>
            {category && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold uppercase tracking-wide">
                {category}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
        </div>
        {status && <div className="sm:pt-1">{status}</div>}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </motion.section>
  );
}
