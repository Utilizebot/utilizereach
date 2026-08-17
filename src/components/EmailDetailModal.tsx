import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, XCircle, User, AtSign, Clock, CheckCircle2, FileText,
  TrendingUp, Eye, MousePointerClick, MessageCircle, AlertTriangle, Loader2,
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

interface Props {
  emailId: string | null;
  onClose: () => void;
}

/** Shared email detail + activity-thread modal (used on Sent Emails and Lead Funnel). */
export function EmailDetailModal({ emailId, onClose }: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!emailId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setDetail(null);
    fetch(`${API_BASE}/api/emails/sent/${emailId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [emailId]);

  const t = detail?.tracking;
  const events = t
    ? [
        ...t.opens.map((o: any) => ({ type: 'open', at: o.opened_at, text: 'Opened' })),
        ...t.clicks.map((c: any) => ({ type: 'click', at: c.clicked_at, text: `Clicked ${c.link_url || 'a link'}` })),
        ...t.replies.map((r: any) => ({ type: 'reply', at: r.received_at, text: `Reply from ${r.from_email || 'recipient'}`, body: r.body_text || r.body })),
        ...t.bounces.map((b: any) => ({ type: 'bounce', at: b.bounced_at, text: `Bounced${b.bounce_type ? ` (${b.bounce_type})` : ''}` })),
      ].sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
    : [];

  return (
    <AnimatePresence>
      {emailId && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl my-4"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Mail className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{detail?.email?.subject || 'Email details'}</h3>
                  <p className="text-xs text-gray-500">Email details &amp; activity thread</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {loading || !detail ? (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <User className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-400">From:</span>
                    <span className="font-medium text-gray-900 truncate">{detail.email.from_email || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <AtSign className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-400">To:</span>
                    <span className="font-medium text-gray-900 truncate">
                      {detail.email.recipient_name ? `${detail.email.recipient_name} · ` : ''}{detail.email.recipient_email}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-400">Sent:</span>
                    <span className="font-medium text-gray-900">{formatDate(detail.email.sent_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <CheckCircle2 className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-400">Status:</span>
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 capitalize">
                      {detail.email.status}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    <FileText className="h-4 w-4" /> Message
                  </div>
                  <div
                    className="prose prose-sm max-w-none border border-gray-200 rounded-xl p-4 bg-gray-50 max-h-72 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: detail.email.body_html || `<pre>${detail.email.body_text || ''}</pre>` }}
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    <TrendingUp className="h-4 w-4" /> Activity Thread
                  </div>
                  <div className="space-y-2">
                    {events.map((ev: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-white">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          ev.type === 'open' ? 'bg-blue-50 text-blue-600'
                            : ev.type === 'click' ? 'bg-purple-50 text-purple-600'
                            : ev.type === 'reply' ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-red-50 text-red-600'}`}
                        >
                          {ev.type === 'open' ? <Eye className="h-4 w-4" />
                            : ev.type === 'click' ? <MousePointerClick className="h-4 w-4" />
                            : ev.type === 'reply' ? <MessageCircle className="h-4 w-4" />
                            : <AlertTriangle className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 break-words">{ev.text}</p>
                          {ev.body && <p className="text-xs text-gray-500 mt-1 line-clamp-3 whitespace-pre-wrap">{ev.body}</p>}
                          {ev.at && <p className="text-xs text-gray-400 mt-0.5">{formatDate(ev.at)}</p>}
                        </div>
                      </div>
                    ))}
                    {events.length === 0 && (
                      <p className="text-sm text-gray-400 py-4 text-center">No activity yet. Opens and replies will appear here.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
