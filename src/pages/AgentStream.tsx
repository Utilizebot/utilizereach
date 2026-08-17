import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Eye, MessageCircle, Search, Calendar,
  AlertCircle, CheckCircle, Radio, WifiOff, Trash2, Zap
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface AgentEvent {
  id: string;
  agent: string;
  action: string;
  detail: string;
  level: 'default' | 'info' | 'success' | 'error';
  timestamp: string;
  type?: string;
}

const AGENT_COLORS: Record<string, { gradient: string; ring: string; badge: string }> = {
  Nancy:     { gradient: 'from-purple-500 to-pink-500',   ring: 'ring-purple-200',  badge: 'bg-purple-100 text-purple-700' },
  Julia:     { gradient: 'from-blue-500 to-cyan-500',     ring: 'ring-blue-200',    badge: 'bg-blue-100 text-blue-700'    },
  Suzie:     { gradient: 'from-emerald-500 to-teal-500',  ring: 'ring-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  Claudia:   { gradient: 'from-amber-500 to-orange-500',  ring: 'ring-amber-200',   badge: 'bg-amber-100 text-amber-700'  },
  Fatima:    { gradient: 'from-rose-500 to-red-500',      ring: 'ring-rose-200',    badge: 'bg-rose-100 text-rose-700'    },
  Noura:     { gradient: 'from-indigo-500 to-purple-500', ring: 'ring-indigo-200',  badge: 'bg-indigo-100 text-indigo-700'},
  Reem:      { gradient: 'from-teal-500 to-green-500',    ring: 'ring-teal-200',    badge: 'bg-teal-100 text-teal-700'   },
  Scraper:   { gradient: 'from-orange-500 to-red-500',    ring: 'ring-orange-200',  badge: 'bg-orange-100 text-orange-700'},
  Scheduler: { gradient: 'from-gray-500 to-gray-600',     ring: 'ring-gray-200',    badge: 'bg-gray-100 text-gray-600'   },
  System:    { gradient: 'from-gray-400 to-gray-500',     ring: 'ring-gray-200',    badge: 'bg-gray-100 text-gray-500'   },
};

const FALLBACK_COLOR = { gradient: 'from-gray-400 to-gray-500', ring: 'ring-gray-200', badge: 'bg-gray-100 text-gray-600' };

const ACTION_META: Record<string, { icon: any; label: string; bg: string; text: string }> = {
  EMAIL_SENT:      { icon: Mail,          label: 'Sent',     bg: 'bg-blue-50',    text: 'text-blue-700'    },
  EMAIL_OPENED:    { icon: Eye,           label: 'Opened',   bg: 'bg-amber-50',   text: 'text-amber-700'   },
  REPLY_RECEIVED:  { icon: MessageCircle, label: 'Replied',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  EMAIL_BOUNCED:   { icon: AlertCircle,   label: 'Bounced',  bg: 'bg-red-50',     text: 'text-red-700'     },
  SCRAPE_COMPLETE: { icon: CheckCircle,   label: 'Scraped',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  SCRAPING:        { icon: Search,        label: 'Scraping', bg: 'bg-orange-50',  text: 'text-orange-700'  },
  SCRAPE_QUEUED:   { icon: Search,        label: 'Queued',   bg: 'bg-gray-50',    text: 'text-gray-600'    },
  SCRAPE_FAILED:   { icon: AlertCircle,   label: 'Failed',   bg: 'bg-red-50',     text: 'text-red-700'     },
  CAMPAIGN_RUN:    { icon: Calendar,      label: 'Campaign', bg: 'bg-purple-50',  text: 'text-purple-700'  },
  SCRAPE_STARTED:  { icon: Search,        label: 'Started',  bg: 'bg-orange-50',  text: 'text-orange-700'  },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Per-event row inside a card ── */
function AgentEventRow({ event, isNew }: { event: AgentEvent; isNew: boolean }) {
  const meta = ACTION_META[event.action] || { icon: Zap, label: event.action, bg: 'bg-gray-50', text: 'text-gray-600' };
  const Icon = meta.icon;

  return (
    <motion.div
      layout
      initial={isNew ? { opacity: 0, y: -6, backgroundColor: '#fffbeb' } : { opacity: 1, y: 0 }}
      animate={{ opacity: 1, y: 0, backgroundColor: '#ffffff' }}
      transition={{ duration: 0.35 }}
      className="flex items-start gap-2.5 px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors"
    >
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 mt-0.5 ${meta.bg} ${meta.text}`}>
        <Icon size={9} />
        {meta.label}
      </span>
      <p className="text-xs text-gray-600 leading-snug flex-1 min-w-0 truncate" title={event.detail}>
        {event.detail}
      </p>
      <span className="text-[10px] text-gray-400 flex-shrink-0 tabular-nums mt-0.5">
        {relativeTime(event.timestamp)}
      </span>
    </motion.div>
  );
}

/* ── Individual agent card ── */
function AgentCard({ agent, events, newIds }: { agent: string; events: AgentEvent[]; newIds: Set<string> }) {
  const colors = AGENT_COLORS[agent] || FALLBACK_COLOR;
  const emailsSent    = events.filter(e => e.action === 'EMAIL_SENT').length;
  const repliesRecvd  = events.filter(e => e.action === 'REPLY_RECEIVED').length;
  const lastEvent     = events[0];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 bg-gray-50/50">
        {/* Avatar */}
        <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${colors.gradient} flex items-center justify-center text-white font-bold text-base shadow flex-shrink-0`}>
          {agent.charAt(0)}
        </div>

        {/* Name + last-seen */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm leading-tight">{agent}</p>
          {lastEvent && (
            <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
              Last active {relativeTime(lastEvent.timestamp)}
            </p>
          )}
        </div>

        {/* Event count badge */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
        <div className="px-4 py-2 text-center">
          <p className="text-base font-bold text-blue-600">{emailsSent}</p>
          <p className="text-[10px] text-gray-400">Emails sent</p>
        </div>
        <div className="px-4 py-2 text-center">
          <p className="text-base font-bold text-emerald-600">{repliesRecvd}</p>
          <p className="text-[10px] text-gray-400">Replies</p>
        </div>
      </div>

      {/* Event list — scrollable, capped height */}
      <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
        {events.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">No events yet</p>
        ) : (
          <AnimatePresence initial={false}>
            {events.slice(0, 50).map(ev => (
              <AgentEventRow key={ev.id} event={ev} isNew={newIds.has(ev.id)} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
}

/* ── Main page ── */
export function AgentStream() {
  const [events, setEvents]     = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [newIds, setNewIds]     = useState<Set<string>>(new Set());
  const [paused, setPaused]     = useState(false);
  const seenIds    = useRef<Set<string>>(new Set());
  const esRef      = useRef<EventSource | null>(null);
  const pausedRef  = useRef(false);
  const pendingRef = useRef<AgentEvent[]>([]);

  pausedRef.current = paused;

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`${API_BASE}/api/stream/agents`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const ev: AgentEvent = JSON.parse(e.data);
        if (ev.type === 'heartbeat' || ev.type === 'error') return;

        const isNew = !seenIds.current.has(ev.id);
        if (!isNew) return;
        seenIds.current.add(ev.id);

        if (pausedRef.current) { pendingRef.current.push(ev); return; }

        setNewIds(prev => new Set([...prev, ev.id]));
        setEvents(prev => [ev, ...prev].slice(0, 500));
        setTimeout(() => setNewIds(prev => { const s = new Set(prev); s.delete(ev.id); return s; }), 3000);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  useEffect(() => {
    if (!paused && pendingRef.current.length > 0) {
      const pending = [...pendingRef.current];
      pendingRef.current = [];
      setEvents(prev => [...pending, ...prev].slice(0, 500));
      const newSet = new Set(pending.map(e => e.id));
      setNewIds(prev => new Set([...prev, ...newSet]));
      setTimeout(() => setNewIds(prev => {
        const s = new Set(prev);
        newSet.forEach(id => s.delete(id));
        return s;
      }), 3000);
    }
  }, [paused]);

  // Group events by agent, preserving insertion order
  const agentMap = new Map<string, AgentEvent[]>();
  events.forEach(ev => {
    if (!agentMap.has(ev.agent)) agentMap.set(ev.agent, []);
    agentMap.get(ev.agent)!.push(ev);
  });
  const agentEntries = Array.from(agentMap.entries());

  const totalEvents   = events.length;
  const activeAgents  = agentEntries.filter(([a]) => a !== 'Scheduler' && a !== 'System' && a !== 'Scraper').length;
  const totalEmails   = events.filter(e => e.action === 'EMAIL_SENT').length;
  const totalReplies  = events.filter(e => e.action === 'REPLY_RECEIVED').length;

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <motion.div
        className="flex flex-wrap items-center justify-between gap-3"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
            <Radio className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agent Activity Stream</h1>
            <p className="text-gray-500 text-sm mt-0.5">Live Events — each agent in their own panel</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
            connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {connected
              ? <><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />Live</>
              : <><WifiOff size={13} />Reconnecting…</>}
          </div>

          <button
            onClick={() => setPaused(p => !p)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              paused
                ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {paused ? `Resume (${pendingRef.current.length} queued)` : 'Pause'}
          </button>

          <button
            onClick={() => { setEvents([]); seenIds.current.clear(); }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </motion.div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total events',     value: totalEvents,  color: 'text-indigo-600'  },
          { label: 'Active agents',    value: activeAgents, color: 'text-emerald-600' },
          { label: 'Emails sent',      value: totalEmails,  color: 'text-blue-600'    },
          { label: 'Replies received', value: totalReplies, color: 'text-emerald-600' },
        ].map(s => (
          <motion.div
            key={s.label}
            className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Agent cards grid: 3 per row ── */}
      {agentEntries.length === 0 ? (
        <motion.div
          className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center justify-center py-20 text-gray-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Radio size={44} className="mb-3 opacity-25" />
          <p className="font-semibold text-base">Waiting for agent activity…</p>
          <p className="text-sm mt-1">Cards will appear here as each agent acts</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {agentEntries.map(([agent, agentEvents]) => (
            <AgentCard
              key={agent}
              agent={agent}
              events={agentEvents}
              newIds={newIds}
            />
          ))}
        </div>
      )}

    </div>
  );
}
