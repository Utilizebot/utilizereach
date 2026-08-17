import { useState, useEffect, useRef } from 'react';
import { Users, Cpu, BarChart2, Shield, CheckCircle, AlertTriangle, TrendingUp, Zap, X } from 'lucide-react';
import { NexusHeader } from '../components/NexusHeader';

// ── Types ──────────────────────────────────────────────────────────────────
interface KPI { label: string; value: string; sub: string; icon: React.ElementType; color: string; bg: string; }
interface Approval { approval_id: string; agent_type: string; payload: any; risk_score: number; status: string; escalated_at: string; }
interface StreamEvent { agent: string; action: string; target: string; timestamp: string; }

const AGENT_COLORS: Record<string, string> = {
  BD_AGENT: '#10B981',
  ADMIN_AGENT: '#F59E0B',
};

const AGENT_LABELS: Record<string, string> = {
  BD_AGENT: 'BD',
  ADMIN_AGENT: 'Admin',
};

// Static sparkline SVG
function Sparkline({ color }: { color: string }) {
  const pts = [10,25,18,30,22,35,28,40,33,45,38,42];
  const max = Math.max(...pts); const min = Math.min(...pts);
  const scale = (v: number) => 45 - ((v - min) / (max - min)) * 40;
  const d = pts.map((v,i) => (i===0?'M':'L') + (i*(60/(pts.length-1))) + ',' + scale(v)).join(' ');
  return <svg viewBox="0 0 60 50" className="w-16 h-8"><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" /></svg>;
}

// Workflow status cards
const WORKFLOWS = [
  { agent: 'BD_AGENT', name: 'Partnership Outreach Round 2', recipients: 342, status: 'SCHEDULED', progress: 0 },
  { agent: 'ADMIN_AGENT', name: 'Regulatory Filing Reminder', recipients: 12, status: 'AWAITING_APPROVAL', progress: 0 },
];

const STATUS_STYLE: Record<string, string> = {
  DISPATCHING: 'bg-emerald-100 text-emerald-700',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  AWAITING_APPROVAL: 'bg-amber-100 text-amber-700',
};

const TEMPLATES = ['Partnership Outreach', 'Regulatory Notice'];
const TEMPLATE_BODIES: Record<string, string> = {
  'Partnership Outreach': `Dear {{partner_name}},

I hope this message finds you well. Following our recent interactions, I wanted to reach out regarding our {{partnership_tier}} partnership opportunity.

We believe {{company_name}} would be an excellent fit for our {{programme_name}} programme.

Best regards,
BD Agent — Nexus Engine`,
  'Regulatory Notice': `Attention: {{official_designation}},

This is an official communication from {{company_name}} regarding {{regulatory_framework}} compliance requirements due on {{deadline_date}}.

Reference: {{agency_code}} / {{clearance_level}}

Admin Agent — Nexus Engine`,
};

export function NexusDashboard() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [stream, setStream] = useState<StreamEvent[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/agents/approvals?status=PENDING')
      .then(r => r.json())
      .then(d => { setApprovals(d.approvals || []); setPendingApprovals((d.approvals || []).length); })
      .catch(() => setApprovals([]));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/v1/agents/stream');
    es.onmessage = e => {
      try {
        const ev: StreamEvent = JSON.parse(e.data);
        setStream(prev => [ev, ...prev].slice(0, 30));
        setTimeout(() => streamRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50);
      } catch {}
    };
    return () => es.close();
  }, []);

  const handleApproval = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/v1/agents/approvals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewer_email: 'admin@nexus.ai' }),
    }).catch(() => {});
    setApprovals(prev => prev.filter(a => a.approval_id !== id));
    setPendingApprovals(prev => Math.max(0, prev - 1));
  };

  const KPIS: KPI[] = [
    { label: 'Total Database', value: '25,000', sub: 'SH: 8,420 · BP: 12,350 · GOV: 1,930', icon: Users, color: '#6366F1', bg: '#EEF2FF' },
    { label: 'Autonomy Rate', value: '98.2%', sub: '1.8% escalated for review', icon: Cpu, color: '#10B981', bg: '#D1FAE5' },
    { label: 'Avg Engagement', value: '34.7%', sub: '+2.3% vs last month', icon: BarChart2, color: '#F59E0B', bg: '#FEF3C7' },
    { label: 'Deliverability', value: '99.8%', sub: 'Domain health: Excellent', icon: Shield, color: '#0EA5E9', bg: '#E0F2FE' },
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader pendingApprovals={pendingApprovals} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-slate-700 font-medium">Dashboard</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Live overview of autonomous agent activity and stakeholder communications.</p>
        </div>
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {KPIS.map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{kpi.label}</span>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: kpi.bg }}>
                  <kpi.icon size={16} style={{ color: kpi.color }} />
                </div>
              </div>
              <div className="text-3xl font-bold text-slate-900 mb-1">{kpi.value}</div>
              <div className="text-xs text-slate-500">{kpi.sub}</div>
              {kpi.label === 'Avg Engagement' && <div className="mt-3"><Sparkline color={kpi.color} /></div>}
              {kpi.label === 'Autonomy Rate' && (
                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: '98.2%' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Two-column workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* LEFT */}
          <div className="space-y-5">
            {/* Active Workflows */}
            <div className="bg-white rounded-xl border border-slate-200 p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Zap size={15} className="text-emerald-500" /> Active Autonomous Workflows
              </h2>
              <div className="space-y-3">
                {WORKFLOWS.map(wf => (
                  <div key={wf.name} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: AGENT_COLORS[wf.agent] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{wf.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_STYLE[wf.status]}`}>{wf.status.replace('_', ' ')}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{AGENT_LABELS[wf.agent]} Agent · {wf.recipients.toLocaleString()} recipients</div>
                      {wf.progress > 0 && <div className="mt-2 h-1 bg-slate-200 rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${wf.progress}%` }} /></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Template Preview */}
            <div className="bg-white rounded-xl border border-slate-200 p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Template Preview
                </h2>
                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                  {TEMPLATES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs leading-relaxed overflow-auto max-h-48" style={{ color: '#94A3B8' }}>
                {TEMPLATE_BODIES[selectedTemplate].split(/({{[^}]+}})/).map((part, i) =>
                  part.startsWith('{{') ? <span key={i} className="text-emerald-400 font-semibold">{part}</span> : <span key={i}>{part}</span>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="space-y-5">
            {/* Agent stream */}
            <div className="bg-white rounded-xl border border-slate-200 p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <TrendingUp size={15} className="text-blue-500" /> Real-Time Agent Stream
              </h2>
              <div ref={streamRef} className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {stream.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Connecting to agent stream...</p>}
                {stream.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded text-white font-medium flex-shrink-0" style={{ background: AGENT_COLORS[ev.agent] || '#94A3B8', fontSize: 10 }}>
                      {AGENT_LABELS[ev.agent] || ev.agent}
                    </span>
                    <span className="text-slate-700 font-medium">{ev.action}</span>
                    <span className="text-slate-400 truncate flex-1">{ev.target}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Exception queue */}
            <div className="bg-white rounded-xl border border-slate-200 p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" /> Exception Review
                {approvals.length > 0 && <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{approvals.length} pending</span>}
              </h2>
              <div className="space-y-3">
                {approvals.length === 0 && <p className="text-xs text-slate-400 text-center py-3">No pending approvals — agents running autonomously</p>}
                {approvals.slice(0, 3).map(a => (
                  <div key={a.approval_id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-700">{AGENT_LABELS[a.agent_type] || a.agent_type} Agent</span>
                      <span className={`text-xs font-bold ${a.risk_score > 80 ? 'text-red-500' : a.risk_score > 50 ? 'text-amber-500' : 'text-emerald-500'}`}>Risk: {a.risk_score?.toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 truncate">{a.payload?.campaign || a.payload?.reason || 'Campaign dispatch'}</p>
                    <div className="flex gap-2">
                      <button onClick={() => handleApproval(a.approval_id, 'APPROVED')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 border border-emerald-200 transition-colors">
                        <CheckCircle size={12} /> Approve
                      </button>
                      <button onClick={() => handleApproval(a.approval_id, 'REJECTED')} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 border border-red-200 transition-colors">
                        <X size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default NexusDashboard;
