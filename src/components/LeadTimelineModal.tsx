import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, XCircle, Building2, Briefcase, Mail, Eye,
  MousePointerClick, MessageCircle, AlertTriangle, Loader2,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatDate(d?: string) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d;
  }
}

type EventType = 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced';

interface TimelineEvent {
  type: EventType;
  at: string;
  persona: string;
  subject: string;
  detail?: string | null;
}

interface Lead {
  name: string | null;
  email: string;
  company: string | null;
  title: string | null;
  segment: string | null;
  status: string | null;
}

interface ActivityData {
  lead: Lead | null;
  stats: { emails: number; opens: number; clicks: number; replies: number; bounces: number };
  timeline: TimelineEvent[];
}

const EVENT_STYLES: Record<EventType, { icon: typeof Mail; ring: string; label: string }> = {
  sent: { icon: Mail, ring: 'bg-gray-100 text-gray-600', label: 'Sent' },
  opened: { icon: Eye, ring: 'bg-amber-50 text-amber-600', label: 'Opened' },
  clicked: { icon: MousePointerClick, ring: 'bg-blue-50 text-blue-600', label: 'Clicked' },
  replied: { icon: MessageCircle, ring: 'bg-emerald-50 text-emerald-600', label: 'Replied' },
  bounced: { icon: AlertTriangle, ring: 'bg-red-50 text-red-600', label: 'Bounced' },
};

interface Props {
  email: string | null;
  onClose: () => void;
}

/** Modal showing a single lead's full activity history / timeline. */
export function LeadTimelineModal({ email, onClose }: Props) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      setData(null);
      return;
    }
    setLoading(true);
    setData(null);
    fetch(`${API_BASE}/api/leads/activity?email=${encodeURIComponent(email)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [email]);

  const lead = data?.lead;
  const stats = data?.stats;
  // API returns oldest -> newest; render newest first.
  const timeline = data?.timeline ? [...data.timeline].reverse() : [];

  const statItems = stats
    ? [
        { label: 'Emails', value: stats.emails, color: 'text-gray-900' },
        { label: 'Opens', value: stats.opens, color: 'text-amber-600' },
        { label: 'Clicks', value: stats.clicks, color: 'text-blue-600' },
        { label: 'Replies', value: stats.replies, color: 'text-emerald-600' },
        { label: 'Bounces', value: stats.bounces, color: 'text-red-600' },
      ]
    : [];

  return (
    <AnimatePresence>
      {email && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl my-4"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{lead?.name || email}</h3>
                  <p className="text-xs text-gray-500 truncate">{lead?.email || email}</p>
                  {(lead?.company || lead?.title) && (
                    <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-gray-500">
                      {lead?.company && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5 text-gray-400" />{lead.company}
                        </span>
                      )}
                      {lead?.company && lead?.title && <span className="text-gray-300">·</span>}
                      {lead?.title && (
                        <span className="inline-flex items-center gap-1">
                          <Briefcase className="h-3.5 w-3.5 text-gray-400" />{lead.title}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    {lead?.segment && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 capitalize">
                        {lead.segment}
                      </span>
                    )}
                    {lead?.status && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 capitalize">
                        {lead.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {loading || !data ? (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {stats && (
                  <div className="grid grid-cols-5 gap-2">
                    {statItems.map((s) => (
                      <div key={s.label} className="rounded-xl border border-gray-100 bg-gray-50 px-2 py-3 text-center">
                        <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    <Activity className="h-4 w-4" /> Activity Timeline
                    <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">(newest first)</span>
                  </div>

                  {timeline.length === 0 ? (
                    <p className="text-sm text-gray-400 py-8 text-center">No activity recorded for this lead yet.</p>
                  ) : (
                    <div className="relative pl-2">
                      <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gray-200" aria-hidden />
                      <div className="space-y-4">
                        {timeline.map((ev, i) => {
                          const style = EVENT_STYLES[ev.type] ?? EVENT_STYLES.sent;
                          const Icon = style.icon;
                          return (
                            <div key={i} className="relative flex items-start gap-3">
                              <div className={`relative z-10 h-9 w-9 rounded-full ring-4 ring-white flex items-center justify-center flex-shrink-0 ${style.ring}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-gray-900">{style.label}</span>
                                  {ev.persona && (
                                    <span className="text-xs text-gray-500">by {ev.persona}</span>
                                  )}
                                  <span className="text-xs text-gray-400 ml-auto">{formatDate(ev.at)}</span>
                                </div>
                                {ev.subject && (
                                  <p className="text-sm text-gray-700 break-words mt-0.5">{ev.subject}</p>
                                )}
                                {ev.detail && (
                                  <p className="text-xs text-gray-500 mt-1 line-clamp-3 whitespace-pre-wrap border-l-2 border-gray-200 pl-2">
                                    {ev.detail}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
