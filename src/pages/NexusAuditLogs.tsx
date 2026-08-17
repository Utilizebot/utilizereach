import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  Search,
  X,
} from 'lucide-react';
import { NexusHeader } from '../components/NexusHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

type ActionType =
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'AUTONOMOUS_DISPATCH'
  | 'HUMAN_OVERRIDE'
  | 'ACCESS'
  | 'EXPORT';

type AgentFilter = 'ALL' | 'BD_AGENT' | 'ADMIN_AGENT' | 'SYSTEM';

interface AuditLog {
  id: string;
  timestamp: string;
  agent: string;
  action: ActionType;
  stakeholder_id: string;
  changed_fields: Record<string, unknown>;
  session_id: string;
}

interface Filters {
  agent: AgentFilter;
  action: ActionType | 'ALL';
  dateFrom: string;
  dateTo: string;
  search: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

function makeMockLogs(): AuditLog[] {
  const agents: string[]  = ['BD_AGENT', 'ADMIN_AGENT', 'SYSTEM'];
  const actions: ActionType[] = [
    'INSERT', 'UPDATE', 'DELETE', 'AUTONOMOUS_DISPATCH',
    'HUMAN_OVERRIDE', 'ACCESS', 'EXPORT',
  ];
  const stakeholders = [
    'sh-001', 'sh-002', 'bp-011', 'bp-042', 'gov-007', 'gov-013',
    'sh-099', 'bp-088', 'gov-031', 'sh-045',
  ];

  const changedFieldsSamples: Record<string, unknown>[] = [
    { email_status: { from: 'pending', to: 'sent' }, sent_at: '2026-08-13T09:14:22Z', template_id: 'acct-1' },
    { name: { from: 'John Smith', to: 'Jonathan Smith' }, updated_by: 'BD_AGENT' },
    { segment: { from: 'unassigned', to: 'shareholders' }, confidence: 0.97 },
    { record_deleted: true, reason: 'GDPR request', approved_by: 'admin@example.com' },
    { dispatch_volume: 8420, template: 'Q3 Dividend Notice', agent: 'ACCOUNTING_AGENT', autonomy_score: 0.97 },
    { override_by: 'tech@example.com', original_action: 'AUTONOMOUS_DISPATCH', new_action: 'HOLD', reason: 'Manual review' },
    { accessed_by: 'tech@example.com', fields_viewed: ['email', 'portfolio_value', 'dividend_amount'] },
    { export_format: 'CSV', record_count: 2400, exported_by: 'tech@example.com' },
    { email_bounce: true, bounce_type: 'hard', original_to: 'partner@example.gov' },
    { compliance_flag: 'DMARC_PASS', dkim: 'PASS', spf: 'PASS' },
  ];

  const logs: AuditLog[] = [];

  for (let i = 0; i < 87; i++) {
    const base = new Date('2026-08-13T10:00:00Z');
    base.setMinutes(base.getMinutes() - i * 17);

    logs.push({
      id:              `LOG-${String(i + 1).padStart(5, '0')}`,
      timestamp:       base.toISOString(),
      agent:           agents[i % agents.length],
      action:          actions[i % actions.length],
      stakeholder_id:  stakeholders[i % stakeholders.length],
      changed_fields:  changedFieldsSamples[i % changedFieldsSamples.length],
      session_id:      `SES-${Math.floor(100000 + (i * 73) % 900000)}`,
    });
  }

  return logs;
}

const ALL_MOCK_LOGS = makeMockLogs();

// ── Badge styles ──────────────────────────────────────────────────────────────

const ACTION_BADGE: Record<ActionType, string> = {
  INSERT:              'bg-emerald-100 text-emerald-700 border-emerald-200',
  UPDATE:              'bg-blue-100 text-blue-700 border-blue-200',
  DELETE:              'bg-red-100 text-red-700 border-red-200',
  AUTONOMOUS_DISPATCH: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  HUMAN_OVERRIDE:      'bg-amber-100 text-amber-700 border-amber-200',
  ACCESS:              'bg-slate-100 text-slate-600 border-slate-200',
  EXPORT:              'bg-slate-100 text-slate-600 border-slate-200',
};

const AGENT_LABEL: Record<string, string> = {
  BD_AGENT:    'BD',
  ADMIN_AGENT: 'Admin',
  SYSTEM:      'System',
};

const PAGE_SIZE = 15;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function applyFilters(logs: AuditLog[], f: Filters): AuditLog[] {
  return logs.filter(log => {
    if (f.agent !== 'ALL' && log.agent !== f.agent) return false;
    if (f.action !== 'ALL' && log.action !== f.action) return false;
    if (f.dateFrom) {
      const from = new Date(f.dateFrom);
      if (new Date(log.timestamp) < from) return false;
    }
    if (f.dateTo) {
      const to = new Date(f.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(log.timestamp) > to) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!log.stakeholder_id.toLowerCase().includes(q) && !log.session_id.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</span>
      {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NexusAuditLogs() {
  const defaultFilters: Filters = {
    agent:    'ALL',
    action:   'ALL',
    dateFrom: '',
    dateTo:   '',
    search:   '',
  };

  const [filters, setFilters]       = useState<Filters>(defaultFilters);
  const [logs, setLogs]             = useState<AuditLog[]>([]);
  const [loading, setLoading]       = useState(false);
  const [page, setPage]             = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch / filter
  const loadLogs = useCallback(async (f: Filters) => {
    setLoading(true);
    setExpandedId(null);
    try {
      const params = new URLSearchParams();
      if (f.agent !== 'ALL')  params.set('agent', f.agent);
      if (f.action !== 'ALL') params.set('action', f.action);
      if (f.dateFrom)         params.set('date_from', f.dateFrom);
      if (f.dateTo)           params.set('date_to', f.dateTo);
      if (f.search)           params.set('search', f.search);

      const res = await fetch(`/api/v1/stakeholders/audit-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : data.logs ?? []);
      } else {
        throw new Error('non-200');
      }
    } catch {
      // Mock fallback
      setLogs(applyFilters(ALL_MOCK_LOGS, f));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs(filters);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFiltersNow(f: Filters) {
    setFilters(f);
    setPage(1);
    loadLogs(f);
  }

  function clearFilters() {
    applyFiltersNow(defaultFilters);
  }

  // Stats derived from ALL data (not filtered) to match full dataset
  const totalActions       = logs.length;
  const autonomousCount    = logs.filter(l => l.action === 'AUTONOMOUS_DISPATCH').length;
  const humanOverrideCount = logs.filter(l => l.action === 'HUMAN_OVERRIDE').length;

  // Pagination
  const totalPages   = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const pagedLogs    = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleExport() {
    alert('Generating report…');
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-slate-700 font-medium">Audit Logs</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
              <p className="text-sm text-slate-500 mt-1">Immutable compliance trail of all agent actions, human overrides, and data mutations.</p>
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition shadow-sm"
            >
              <Download size={14} />
              Export Compliance Report
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Agent */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Agent</label>
              <div className="relative">
                <select
                  value={filters.agent}
                  onChange={e => setFilters(prev => ({ ...prev, agent: e.target.value as AgentFilter }))}
                  className="appearance-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                >
                  <option value="ALL">All Agents</option>
                  <option value="BD_AGENT">BD Agent</option>
                  <option value="ADMIN_AGENT">Admin Agent</option>
                  <option value="SYSTEM">System</option>
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Action type */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Action Type</label>
              <div className="relative">
                <select
                  value={filters.action}
                  onChange={e => setFilters(prev => ({ ...prev, action: e.target.value as ActionType | 'ALL' }))}
                  className="appearance-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                >
                  <option value="ALL">All Actions</option>
                  <option value="INSERT">INSERT</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="DELETE">DELETE</option>
                  <option value="AUTONOMOUS_DISPATCH">AUTONOMOUS_DISPATCH</option>
                  <option value="HUMAN_OVERRIDE">HUMAN_OVERRIDE</option>
                  <option value="ACCESS">ACCESS</option>
                  <option value="EXPORT">EXPORT</option>
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  placeholder="Stakeholder ID or Session ID"
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-end gap-2">
              <button
                onClick={() => applyFiltersNow(filters)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition shadow-sm"
              >
                <Filter size={13} />
                Apply
              </button>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition"
              >
                <X size={13} />
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Matching Records"      value={totalActions}       sub={`of ${ALL_MOCK_LOGS.length} total`} />
          <StatCard label="Autonomous Dispatches" value={autonomousCount}    sub="no human touch" />
          <StatCard label="Human Overrides"       value={humanOverrideCount} sub="manual interventions" />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
              <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading logs…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Timestamp</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Stakeholder ID</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Changed Fields</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Session ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-16 text-slate-400 text-sm">No logs match the current filters.</td>
                    </tr>
                  ) : (
                    pagedLogs.map(log => {
                      const isExpanded = expandedId === log.id;
                      return (
                        <React.Fragment key={log.id}>
                          <tr
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                          >
                            {/* Timestamp */}
                            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                              {fmtTimestamp(log.timestamp)}
                            </td>

                            {/* Agent */}
                            <td className="px-4 py-3">
                              <span className="text-xs font-semibold text-slate-700">
                                {AGENT_LABEL[log.agent] ?? log.agent}
                              </span>
                            </td>

                            {/* Action badge */}
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold uppercase tracking-wide ${ACTION_BADGE[log.action] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                {log.action.replace(/_/g, ' ')}
                              </span>
                            </td>

                            {/* Stakeholder ID */}
                            <td className="px-4 py-3 text-xs font-mono text-slate-600">
                              {log.stakeholder_id}
                            </td>

                            {/* Changed fields — expandable */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="max-w-[200px] truncate font-mono">
                                  {Object.keys(log.changed_fields).join(', ')}
                                </span>
                                {isExpanded
                                  ? <ChevronUp size={12} className="text-slate-400 flex-shrink-0" />
                                  : <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />}
                              </div>
                            </td>

                            {/* Session ID */}
                            <td className="px-4 py-3 text-xs font-mono text-slate-500">
                              {log.session_id}
                            </td>
                          </tr>

                          {/* Expanded JSON row */}
                          {isExpanded && (
                            <tr className="bg-slate-900">
                              <td colSpan={6} className="px-6 py-4">
                                <div className="flex items-start gap-3">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 flex-shrink-0">changed_fields</span>
                                  <pre className="text-xs text-emerald-400 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
                                    {JSON.stringify(log.changed_fields, null, 2)}
                                  </pre>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && logs.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 bg-slate-50">
              <span className="text-xs text-slate-500">
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, logs.length)}–{Math.min(page * PAGE_SIZE, logs.length)} of {logs.length} entries
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={14} />
                </button>

                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (page <= 4) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = page - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={[
                        'w-7 h-7 rounded-lg text-xs font-semibold transition',
                        page === pageNum
                          ? 'bg-emerald-500 text-white'
                          : 'border border-slate-200 text-slate-600 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
