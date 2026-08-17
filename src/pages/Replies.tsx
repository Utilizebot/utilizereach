import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Inbox, MessageCircle, Loader2, Mail, User, Clock, CheckCircle2,
  RefreshCw, ChevronDown, ChevronUp, Eye,
} from 'lucide-react';
import { EmailDetailModal } from '../components/EmailDetailModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Reply {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  body_text: string | null;
  received_at: string;
  reviewed: boolean;
  sent_email_id: string;
  campaign_id: string | null;
  sent_emails: {
    from_email: string;
    recipient_email: string;
    recipient_name: string | null;
    subject: string;
  } | null;
}

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

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A small palette so each persona gets a stable-ish color.
const PERSONA_COLORS = [
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-purple-100 text-purple-700',
  'bg-indigo-100 text-indigo-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
];
function personaColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PERSONA_COLORS[h % PERSONA_COLORS.length];
}

/** Strip quoted history that starts at a line beginning with "________" or "From:". */
function stripQuoted(body: string): string {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimStart();
    if (l.startsWith('________') || /^From:\s/i.test(l)) {
      return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return body;
}

export function Replies() {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'unreviewed' | 'all'>('unreviewed');
  const [emailId, setEmailId] = useState<string | null>(null);

  const fetchReplies = async () => {
    setLoading(true);
    try {
      const url = filter === 'unreviewed'
        ? `${API_BASE}/api/emails/replies?limit=200&is_reviewed=false`
        : `${API_BASE}/api/emails/replies?limit=200`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setReplies(data.replies || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchReplies(); }, [filter]);

  const setReviewed = async (id: string, is_reviewed: boolean) => {
    await fetch(`${API_BASE}/api/emails/replies/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed }),
    });
    fetchReplies();
  };

  const sorted = [...replies].sort(
    (a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime()
  );
  const unreviewedCount = replies.filter((r) => !r.reviewed).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Inbox className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Replies</h1>
            <p className="text-sm text-gray-500">Incoming replies from your outreach</p>
          </div>
        </div>
        <button
          onClick={fetchReplies}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-all"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => setFilter('unreviewed')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === 'unreviewed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Unreviewed
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All
          </button>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
          {unreviewedCount} unreviewed
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <MessageCircle className="h-14 w-14 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-semibold text-gray-800">No replies yet</p>
          <p className="text-sm text-gray-500 mt-1">They&apos;ll show up here as leads respond.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((r) => (
            <ReplyCard
              key={r.id}
              reply={r}
              onReview={setReviewed}
              onViewThread={() => setEmailId(r.sent_email_id)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {emailId && <EmailDetailModal emailId={emailId} onClose={() => setEmailId(null)} />}
      </AnimatePresence>
    </div>
  );
}

function ReplyCard({
  reply, onReview, onViewThread,
}: {
  reply: Reply;
  onReview: (id: string, is_reviewed: boolean) => void;
  onViewThread: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const persona = reply.sent_emails?.from_email?.split('@')[0] || 'unknown';
  const leadName = reply.from_name || reply.from_email;
  const subject = reply.subject || reply.sent_emails?.subject || '(no subject)';
  const rawBody = reply.body_text || '';
  const cleanBody = stripQuoted(rawBody).trim();
  const isLong = cleanBody.split('\n').length > 4 || cleanBody.length > 320;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <User className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-900 truncate">{leadName}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${personaColor(persona)}`}
                  title={`Replied to ${reply.sent_emails?.from_email || persona}`}
                >
                  ↳ {cap(persona)}
                </span>
              </div>
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" /> {reply.from_email}
              </p>
            </div>
          </div>
          {reply.reviewed ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold flex-shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold flex-shrink-0">
              New
            </span>
          )}
        </div>

        <h3 className="font-semibold text-gray-900 mt-4">{subject}</h3>

        <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
          <p className={!expanded && isLong ? 'line-clamp-4' : ''}>
            {cleanBody || <span className="text-gray-400 italic">No message body</span>}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              {expanded ? <><ChevronUp className="h-3.5 w-3.5" /> Show less</> : <><ChevronDown className="h-3.5 w-3.5" /> Show more</>}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1 mt-3">
          <Clock className="h-3 w-3" /> {formatDate(reply.received_at)}
        </p>
      </div>

      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
        {reply.reviewed ? (
          <button
            onClick={() => onReview(reply.id, false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all"
          >
            <Mail className="h-4 w-4" /> Mark unread
          </button>
        ) : (
          <button
            onClick={() => onReview(reply.id, true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-50 transition-all"
          >
            <CheckCircle2 className="h-4 w-4" /> Mark reviewed
          </button>
        )}
        <button
          onClick={onViewThread}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-purple-600 hover:bg-purple-50 transition-all"
        >
          <Eye className="h-4 w-4" /> View thread
        </button>
      </div>
    </motion.div>
  );
}
