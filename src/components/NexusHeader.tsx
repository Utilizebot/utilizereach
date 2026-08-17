import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell, Pause, CircleDot } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'nexus',        label: 'Dashboard',       path: '/nexus' },
  { id: 'stakeholders', label: 'Stakeholders',    path: '/nexus/stakeholders' },
  { id: 'campaigns',    label: 'Campaigns',       path: '/nexus/campaigns' },
  { id: 'agent-hub',    label: 'Agent Hub',       path: '/nexus/agent-hub' },
  { id: 'audit-logs',   label: 'Audit Logs',      path: '/nexus/audit-logs' },
  { id: 'settings',     label: 'Settings',        path: '/nexus/settings' },
];

const SUB_MENUS: Record<string, string[]> = {
  'nexus':        ['Overview', 'KPI Metrics', 'Recent Activity'],
  'stakeholders': ['All (25k)', 'Shareholders', 'Business Partners', 'Gov Agencies', 'Unassigned'],
  'campaigns':    ['Templates', 'Active Campaigns', 'Scheduled', 'Archive'],
  'agent-hub':    ['Agent Telemetry', 'BD Agent', 'Admin Agent', 'Exception Queue', 'Guardrail Policies'],
  'audit-logs':   ['System Logs', 'Agent Actions', 'Human Overrides', 'Compliance Trail'],
  'settings':     ['General', 'Email Config', 'DMARC/DKIM', 'Integrations', 'Roles'],
};

interface NexusHeaderProps {
  pendingApprovals?: number;
  agentStatuses?: { bd: boolean; admin: boolean };
  onToggleAgent?: (key: 'bd' | 'admin') => void;
  onEmergencyPause?: () => void;
}

export function NexusHeader({ pendingApprovals = 0, agentStatuses, onToggleAgent, onEmergencyPause }: NexusHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeSubItem, setActiveSubItem] = useState<string>('');
  const [allPaused, setAllPaused] = useState(false);
  const [localStatuses, setLocalStatuses] = useState<{ bd: boolean; admin: boolean }>({ bd: true, admin: true });
  const statuses = agentStatuses ?? localStatuses;

  function handleToggleAgent(key: 'bd' | 'admin') {
    if (onToggleAgent) {
      onToggleAgent(key);
    } else {
      setLocalStatuses(prev => ({ ...prev, [key]: !prev[key] }));
    }
  }

  const activeNav = NAV_ITEMS.find(
    n => location.pathname === n.path || (n.path !== '/nexus' && location.pathname.startsWith(n.path))
  )?.id || 'nexus';

  const subItems = SUB_MENUS[activeNav] || [];

  useEffect(() => {
    setActiveSubItem('');
  }, [activeNav]);

  const agentPills = [
    { label: 'BD', key: 'bd' as const },
    { label: 'Admin', key: 'admin' as const },
  ];

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Primary header bar: status dot | scrollable nav | controls ── */}
      <header
        className="bg-white border-b border-slate-200 h-14 flex items-center sticky top-0 z-50"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        {/* Status dot — fixed left */}
        <div className="px-3 shrink-0 border-r border-slate-100 h-full flex items-center">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>

        {/* Scrollable nav — fills remaining space */}
        <div className="flex-1 overflow-x-auto min-w-0 h-full">
          <nav className="flex items-center gap-0.5 px-2 h-full" style={{ minWidth: 'max-content' }}>
            {NAV_ITEMS.map(item => {
              const isActive = item.id === activeNav;
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-colors shrink-0 ${
                    isActive
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Controls — fixed right */}
        <div className="flex items-center gap-1.5 px-3 shrink-0 border-l border-slate-100 h-full">
          {agentPills.map(p => {
            const isAuto = statuses[p.key];
            return (
              <button
                key={p.key}
                onClick={() => handleToggleAgent(p.key)}
                title={`${p.label} Agent — click to ${isAuto ? 'pause' : 'resume'}`}
                className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer"
                style={{
                  background: isAuto ? '#D1FAE5' : '#F1F5F9',
                  color: isAuto ? '#065F46' : '#64748B',
                  borderColor: isAuto ? '#6EE7B7' : '#E2E8F0',
                }}
              >
                <CircleDot size={10} className={isAuto ? 'text-emerald-500' : 'text-slate-400'} />
                {p.label}: {isAuto ? 'Auto' : 'Paused'}
              </button>
            );
          })}

          {/* Approvals bell */}
          <button
            className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
            onClick={() => navigate('/nexus/agent-hub')}
          >
            <Bell size={17} />
            {pendingApprovals > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {pendingApprovals}
              </span>
            )}
          </button>

          {/* Emergency pause */}
          <button
            onClick={() => {
              const next = !allPaused;
              setAllPaused(next);
              setLocalStatuses({ bd: !next, admin: !next });
              onEmergencyPause?.();
            }}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              allPaused ? 'bg-red-600 text-white border-red-700' : 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200'
            }`}
          >
            <Pause size={11} />
            <span className="hidden sm:inline">{allPaused ? 'Paused ✓' : 'Pause All'}</span>
          </button>
        </div>
      </header>

      {/* Sub-menu bar */}
      {subItems.length > 0 && (
        <div className="bg-slate-50 border-b border-slate-200 h-10 px-4 flex items-center gap-1 overflow-x-auto">
          {subItems.map((sub, i) => (
            <button
              key={sub}
              onClick={() => setActiveSubItem(sub)}
              className={[
                'px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                activeSubItem === sub || (i === 0 && !activeSubItem)
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {sub}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default NexusHeader;
