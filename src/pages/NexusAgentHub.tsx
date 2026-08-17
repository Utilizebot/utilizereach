import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle,
  ChevronRight,
  CircleDot,
  Pause,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import NexusHeader from '../components/NexusHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentKey = 'bd' | 'admin';

interface AgentStats {
  campaigns: number;
  emailsDispatched: number;
  escalations: number;
  autonomyRate: number;
}

interface AgentConfig {
  key: AgentKey;
  label: string;
  description: string;
  color: string;
  accentClass: string;
  bgClass: string;
  stats: AgentStats;
}

interface StreamEvent {
  id: string;
  agent: AgentKey;
  message: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface ApprovalItem {
  id: string;
  time: string;
  agent: AgentKey;
  riskScore: number;
  summary: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface GuardrailPolicy {
  id: string;
  icon: React.ReactNode;
  title: string;
  trigger: string;
  action: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

// ─── Static data ──────────────────────────────────────────────────────────────

const AGENT_CONFIGS: AgentConfig[] = [
  {
    key: 'bd',
    label: 'Business Development Agent',
    description:
      'Drives partnership and enterprise pipeline — targets C-suite, VCs, and strategic alliances. Optimises subject lines and send times via real-time engagement signals.',
    color: '#10B981',
    accentClass: 'text-emerald-600',
    bgClass: 'bg-emerald-50',
    stats: {
      campaigns: 7,
      emailsDispatched: 3891,
      escalations: 5,
      autonomyRate: 88,
    },
  },
  {
    key: 'admin',
    label: 'Admin Agent',
    description:
      'Handles operational and compliance communications — government agencies, regulators, and internal stakeholders. Enforces sensitivity rules and approval gates.',
    color: '#F59E0B',
    accentClass: 'text-amber-600',
    bgClass: 'bg-amber-50',
    stats: {
      campaigns: 2,
      emailsDispatched: 489,
      escalations: 9,
      autonomyRate: 71,
    },
  },
];

const GUARDRAIL_POLICIES: GuardrailPolicy[] = [
  {
    id: 'volume-anomaly',
    icon: <BarChart3 size={18} />,
    title: 'Volume Anomaly Detection',
    trigger: '>1,000 emails / hour',
    action: 'Auto-pause agent',
    description:
      'Any agent exceeding 1,000 dispatches per hour is immediately paused and a human-review ticket is raised.',
    severity: 'high',
  },
  {
    id: 'confidence-threshold',
    icon: <TrendingUp size={18} />,
    title: 'Confidence Threshold',
    trigger: 'Model confidence <95%',
    action: 'Route to review queue',
    description:
      'Emails where the agent scores its own confidence below 95% are held and surfaced in the Exception Queue.',
    severity: 'medium',
  },
  {
    id: 'sensitive-recipients',
    icon: <ShieldAlert size={18} />,
    title: 'Sensitive Recipient Gate',
    trigger: 'Government / Regulated entities',
    action: 'Require human approval',
    description:
      'All outreach to government bodies, regulated financial institutions, or listed watchlist domains requires explicit approval.',
    severity: 'high',
  },
  {
    id: 'rate-limiting',
    icon: <Zap size={18} />,
    title: 'Warm-up Rate Limiting',
    trigger: 'New domains / IPs',
    action: 'Cap at 500/hr',
    description:
      'New sending domains are capped at 500 emails per hour during a 14-day warm-up period to protect deliverability.',
    severity: 'low',
  },
];

// ─── Mock fallback data (used when API is unavailable) ────────────────────────

const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: 'apr-001',
    time: '09:42 AM',
    agent: 'admin',
    riskScore: 82,
    summary: 'Outreach to SEC Division of Enforcement — 3 contacts',
    status: 'PENDING',
  },
  {
    id: 'apr-002',
    time: '10:15 AM',
    agent: 'bd',
    riskScore: 67,
    summary: 'Cold campaign to 48 Fortune 500 CFOs flagged for low confidence (91%)',
    status: 'PENDING',
  },
  {
    id: 'apr-004',
    time: '11:47 AM',
    agent: 'admin',
    riskScore: 91,
    summary: 'Batch to Federal Reserve regional contacts — 12 addresses',
    status: 'PENDING',
  },
];

// ─── Helper functions ─────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score < 50) return 'text-emerald-600';
  if (score <= 80) return 'text-amber-500';
  return 'text-red-600';
}

function riskBg(score: number): string {
  if (score < 50) return 'bg-emerald-50 border-emerald-200';
  if (score <= 80) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function agentBadgeColor(agent: AgentKey): string {
  if (agent === 'bd') return 'bg-emerald-100 text-emerald-700';
  return 'bg-amber-100 text-amber-700';
}

function agentLabel(agent: AgentKey): string {
  if (agent === 'bd') return 'BD';
  return 'Admin';
}

function severityBadge(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return 'bg-red-100 text-red-700 border-red-200';
  if (severity === 'medium') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function eventTypeColor(type: StreamEvent['type']): string {
  if (type === 'error') return 'text-red-500';
  if (type === 'warn') return 'text-amber-500';
  if (type === 'success') return 'text-emerald-500';
  return 'text-slate-400';
}

function eventTypeDot(type: StreamEvent['type']): string {
  if (type === 'error') return 'bg-red-500';
  if (type === 'warn') return 'bg-amber-400';
  if (type === 'success') return 'bg-emerald-500';
  return 'bg-slate-400';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AgentCardProps {
  config: AgentConfig;
  running: boolean;
  onToggle: (key: AgentKey) => void;
}

function AgentCard({ config, running, onToggle }: AgentCardProps) {
  const { key, label, description, stats, accentClass, bgClass } = config;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: config.color + '18' }}
          >
            <CircleDot size={18} style={{ color: config.color }} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm leading-tight">{label}</h3>
            <p className="text-xs text-slate-400 mt-0.5">Today's performance</p>
          </div>
        </div>

        {/* Status badge */}
        <span
          className={[
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0',
            running
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-slate-100 text-slate-500 border border-slate-200',
          ].join(' ')}
        >
          <span
            className={[
              'w-1.5 h-1.5 rounded-full',
              running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400',
            ].join(' ')}
          />
          {running ? 'Autonomous' : 'Paused'}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-lg p-3 ${bgClass}`}>
          <p className="text-xs text-slate-500 mb-0.5">Campaigns</p>
          <p className={`text-xl font-bold ${accentClass}`}>{stats.campaigns}</p>
        </div>
        <div className={`rounded-lg p-3 ${bgClass}`}>
          <p className="text-xs text-slate-500 mb-0.5">Dispatched</p>
          <p className={`text-xl font-bold ${accentClass}`}>{stats.emailsDispatched.toLocaleString()}</p>
        </div>
        <div className="rounded-lg p-3 bg-red-50">
          <p className="text-xs text-slate-500 mb-0.5">Escalations</p>
          <p className="text-xl font-bold text-red-600">{stats.escalations}</p>
        </div>
      </div>

      {/* Autonomy rate */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-slate-500 font-medium">Autonomy Rate</span>
          <span className={`text-xs font-bold ${accentClass}`}>{stats.autonomyRate}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${stats.autonomyRate}%`, backgroundColor: config.color }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {100 - stats.autonomyRate}% of actions required human review
        </p>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
        {description}
      </p>

      {/* Toggle button */}
      <button
        onClick={() => onToggle(key)}
        className={[
          'flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-semibold border transition-colors',
          running
            ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            : 'text-white border-transparent hover:opacity-90',
        ].join(' ')}
        style={!running ? { backgroundColor: config.color } : {}}
      >
        {running ? (
          <>
            <Pause size={14} />
            Pause Agent
          </>
        ) : (
          <>
            <Play size={14} />
            Resume Agent
          </>
        )}
      </button>
    </div>
  );
}

// ─── Live Event Stream ────────────────────────────────────────────────────────

interface LiveStreamProps {
  agentFilter: AgentKey | 'all';
  onFilterChange: (f: AgentKey | 'all') => void;
}

function LiveStream({ agentFilter, onFilterChange }: LiveStreamProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const counterRef = useRef(0);

  // Simulate events when SSE is unavailable (dev / demo mode)
  const injectMockEvent = useCallback(() => {
    const agents: AgentKey[] = ['bd', 'admin'];
    const types: StreamEvent['type'][] = ['info', 'info', 'info', 'success', 'warn', 'error'];
    const messages: Record<AgentKey, string[]> = {
      bd: [
        'New enterprise prospect matched — Deloitte partnership track',
        'A/B variant B outperforming variant A by 18% CTR',
        'Partnership outreach batch dispatched: 62 contacts',
        'Volume approaching hourly cap — throttling to 480/hr',
      ],
      admin: [
        'Government domain detected — holding for approval',
        'Compliance tag applied: FINREG-2024-09',
        'Rate-limit enforced: warmup domain restricted to 500/hr',
        'Sensitive recipient gate triggered — SEC contact queued',
      ],
    };

    counterRef.current += 1;
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const msgList = messages[agent];
    const message = msgList[Math.floor(Math.random() * msgList.length)];

    const now = new Date();
    const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setEvents(prev => {
      const updated = [
        { id: `mock-${counterRef.current}`, agent, message, timestamp: ts, type },
        ...prev,
      ].slice(0, 200);
      return updated;
    });
  }, []);

  useEffect(() => {
    let mock: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      try {
        const es = new EventSource('/api/v1/agents/stream');
        esRef.current = es;

        es.onopen = () => {
          setConnected(true);
          setError(null);
        };

        es.onmessage = (e) => {
          try {
            const raw = JSON.parse(e.data);
            // Backend sends {agent, action, target, timestamp} — normalise to StreamEvent shape
            const agentKey = String(raw.agent ?? '')
              .toLowerCase()
              .replace('_agent', '') as AgentKey;
            const action: string = raw.action ?? '';
            const type: StreamEvent['type'] =
              action.includes('ESCALAT') || action.includes('ERROR') ? 'warn'
              : action.includes('DISPATCH') || action.includes('SCORED') || action.includes('SYNCED') ? 'success'
              : 'info';
            const data: StreamEvent = {
              id: `sse-${Date.now()}-${Math.random()}`,
              agent: (['bd', 'admin'] as AgentKey[]).includes(agentKey) ? agentKey : 'bd',
              message: raw.target ? `${action} → ${raw.target}` : action,
              timestamp: raw.timestamp
                ? new Date(raw.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : new Date().toLocaleTimeString(),
              type,
            };
            setEvents(prev => [data, ...prev].slice(0, 200));
          } catch {
            // ignore malformed events
          }
        };

        es.onerror = () => {
          setConnected(false);
          setError('SSE connection unavailable — using simulated stream');
          es.close();
          // Fall back to mock
          mock = setInterval(injectMockEvent, 2200);
        };
      } catch {
        setError('EventSource not supported — using simulated stream');
        mock = setInterval(injectMockEvent, 2200);
      }
    };

    connect();
    // Kick off first mock event immediately if SSE fails (handled in onerror)

    return () => {
      esRef.current?.close();
      if (mock) clearInterval(mock);
    };
  }, [injectMockEvent]);

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const filtered = agentFilter === 'all' ? events : events.filter(e => e.agent === agentFilter);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden" style={{ minHeight: 380 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Live Agent Stream</h3>
          <span
            className={[
              'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
              connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
            ].join(' ')}
          >
            <span className={['w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'].join(' ')} />
            {connected ? 'Live' : 'Simulated'}
          </span>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {(['all', 'bd', 'admin'] as const).map(f => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={[
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize',
                agentFilter === f
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-100',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : agentLabel(f as AgentKey)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* Events list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto divide-y divide-slate-50"
        style={{ maxHeight: 340 }}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <Activity size={24} className="opacity-40" />
            <p className="text-sm">Waiting for events…</p>
          </div>
        ) : (
          filtered.map((ev, i) => (
            <div
              key={ev.id ?? i}
              className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className={['w-2 h-2 rounded-full mt-1.5 flex-shrink-0', eventTypeDot(ev.type)].join(' ')} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 leading-snug">{ev.message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded', agentBadgeColor(ev.agent)].join(' ')}>
                    {agentLabel(ev.agent)}
                  </span>
                  {ev.type && (
                    <span className={['text-[10px] font-medium', eventTypeColor(ev.type)].join(' ')}>
                      {ev.type.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">{ev.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Exception Queue ──────────────────────────────────────────────────────────

function ExceptionQueue() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agents/approvals?status=PENDING');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.items ?? []);
    } catch {
      // Fall back to mock data
      setItems(MOCK_APPROVALS);
      setError('Using demo data — API unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    setProcessing(p => ({ ...p, [id]: true }));
    try {
      await fetch(`/api/v1/agents/approvals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      });
    } catch {
      // optimistic even without server
    } finally {
      setItems(prev => prev.filter(i => i.id !== id));
      setProcessing(p => ({ ...p, [id]: false }));
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Exception Queue</h3>
          {items.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
              {items.length}
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading approvals…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
          <CheckCircle size={28} className="text-emerald-400" />
          <p className="text-sm font-medium text-slate-600">All clear — no pending approvals</p>
          <p className="text-xs">The exception queue is empty.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 whitespace-nowrap">Time</th>
                <th className="px-5 py-3 whitespace-nowrap">Agent</th>
                <th className="px-5 py-3 whitespace-nowrap">Risk Score</th>
                <th className="px-5 py-3">Summary</th>
                <th className="px-5 py-3 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap font-mono">
                    {item.time}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className={['text-xs font-semibold px-2 py-1 rounded-md', agentBadgeColor(item.agent)].join(' ')}>
                      {agentLabel(item.agent)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'text-xs font-bold px-2 py-1 rounded-md border',
                          riskBg(item.riskScore),
                          riskColor(item.riskScore),
                        ].join(' ')}
                      >
                        {item.riskScore}
                      </span>
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${item.riskScore}%`,
                            backgroundColor:
                              item.riskScore < 50 ? '#10B981' : item.riskScore <= 80 ? '#F59E0B' : '#EF4444',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-700 max-w-sm">
                    {item.summary}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => handleAction(item.id, 'APPROVED')}
                        disabled={!!processing[item.id]}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle size={12} />
                        Approve
                      </button>
                      <button
                        onClick={() => handleAction(item.id, 'REJECTED')}
                        disabled={!!processing[item.id]}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        <XCircle size={12} />
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Guardrail Policies ───────────────────────────────────────────────────────

function GuardrailPolicies() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Shield size={16} className="text-slate-600" />
        <h3 className="font-semibold text-slate-900 text-sm">Guardrail Policies</h3>
        <span className="text-xs text-slate-400 ml-1">4 active rules</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {GUARDRAIL_POLICIES.map(policy => (
          <div
            key={policy.id}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                  {policy.icon}
                </div>
                <h4 className="font-semibold text-slate-900 text-sm">{policy.title}</h4>
              </div>
              <span
                className={[
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide flex-shrink-0',
                  severityBadge(policy.severity),
                ].join(' ')}
              >
                {policy.severity}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Trigger</p>
                <p className="text-xs text-slate-700 font-medium">{policy.trigger}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Action</p>
                <p className="text-xs text-slate-700 font-medium">{policy.action}</p>
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">{policy.description}</p>

            <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
              <ShieldCheck size={12} className="text-emerald-500" />
              <span className="text-[10px] text-emerald-600 font-semibold">Active</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page component ───────────────────────────────────────────────────────

type Tab = 'telemetry' | 'exceptions' | 'guardrails';

export function NexusAgentHub() {
  const [agentStatuses, setAgentStatuses] = useState<Record<AgentKey, boolean>>({
    bd: true,
    admin: true,
  });
  const [activeTab, setActiveTab] = useState<Tab>('telemetry');
  const [streamFilter, setStreamFilter] = useState<AgentKey | 'all'>('all');
  const [pendingCount] = useState(MOCK_APPROVALS.length);

  const handleToggle = useCallback((key: AgentKey) => {
    setAgentStatuses(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleEmergencyPause = useCallback(() => {
    setAgentStatuses({ bd: false, admin: false });
  }, []);

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'telemetry', label: 'Agent Telemetry', icon: <Activity size={14} /> },
    { id: 'exceptions', label: 'Exception Queue', icon: <AlertTriangle size={14} />, badge: pendingCount },
    { id: 'guardrails', label: 'Guardrail Policies', icon: <Shield size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader
        pendingApprovals={pendingCount}
        agentStatuses={agentStatuses}
        onEmergencyPause={handleEmergencyPause}
      />

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page title row */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>Nexus</span>
              <ChevronRight size={12} />
              <span className="text-slate-700 font-medium">Agent Hub</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Agent Hub</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Monitor, control, and review all autonomous marketing agents in real time.
            </p>
          </div>

          {/* Summary chips */}
          <div className="hidden sm:flex items-center gap-3">
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center shadow-sm">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Running</p>
              <p className="text-xl font-bold text-emerald-600">
                {Object.values(agentStatuses).filter(Boolean).length}
                <span className="text-sm text-slate-400 font-normal"> / 3</span>
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center shadow-sm">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Dispatched</p>
              <p className="text-xl font-bold text-slate-900">4,380</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center shadow-sm">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Pending</p>
              <p className="text-xl font-bold text-amber-600">{pendingCount}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors relative',
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              {tab.icon}
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span
                  className={[
                    'text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center',
                    activeTab === tab.id ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700',
                  ].join(' ')}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'telemetry' && (
          <div className="flex flex-col gap-6">
            {/* Agent cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {AGENT_CONFIGS.map(cfg => (
                <AgentCard
                  key={cfg.key}
                  config={cfg}
                  running={agentStatuses[cfg.key]}
                  onToggle={handleToggle}
                />
              ))}
            </div>

            {/* Live stream */}
            <LiveStream agentFilter={streamFilter} onFilterChange={setStreamFilter} />
          </div>
        )}

        {activeTab === 'exceptions' && (
          <ExceptionQueue />
        )}

        {activeTab === 'guardrails' && (
          <GuardrailPolicies />
        )}
      </main>
    </div>
  );
}

export default NexusAgentHub;
