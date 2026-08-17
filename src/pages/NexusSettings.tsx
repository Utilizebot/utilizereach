import React, { useState } from 'react';
import { NexusHeader } from '../components/NexusHeader';
import {
  Settings,
  Mail,
  Shield,
  Zap,
  Users,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
} from 'lucide-react';

type SettingsTab = 'general' | 'email' | 'dmarc' | 'agents' | 'roles';

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'general',  label: 'General',     icon: Settings },
  { id: 'email',    label: 'Email Config', icon: Mail     },
  { id: 'dmarc',    label: 'DMARC / DKIM', icon: Shield   },
  { id: 'agents',   label: 'Agent Config', icon: Zap      },
  { id: 'roles',    label: 'Roles',        icon: Users    },
];

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0 pr-6">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
        on
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-slate-100 text-slate-500 border-slate-200'
      }`}
    >
      {on ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
      {on ? 'Enabled' : 'Disabled'}
    </button>
  );
}

function GeneralTab() {
  const [autonomy, setAutonomy] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [auditLog, setAuditLog] = useState(true);

  return (
    <div>
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">General</h2>
      <div className="bg-white rounded-xl border border-slate-200 px-5 shadow-sm">
        <SettingRow
          label="Autonomous Execution"
          description="Allow agents to dispatch emails without human review when guardrails pass."
          control={<Toggle on={autonomy} onChange={() => setAutonomy(v => !v)} />}
        />
        <SettingRow
          label="Email Notifications"
          description="Send escalation and exception alerts to the configured admin email."
          control={<Toggle on={notifications} onChange={() => setNotifications(v => !v)} />}
        />
        <SettingRow
          label="Immutable Audit Log"
          description="Record every agent action to stakeholder_audit_logs (cannot be disabled in compliance mode)."
          control={<Toggle on={auditLog} onChange={() => setAuditLog(v => !v)} />}
        />
        <SettingRow
          label="System Version"
          description="Nexus Marketing Engine"
          control={<span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">v1.0.0</span>}
        />
      </div>
    </div>
  );
}

function EmailConfigTab() {
  const [saved, setSaved] = React.useState(false);
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Email Configuration</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        {[
          { label: 'SMTP Host', placeholder: 'smtp.yourdomain.com', type: 'text' },
          { label: 'SMTP Port', placeholder: '587', type: 'number' },
          { label: 'Sending Domain', placeholder: 'mail.yourdomain.com', type: 'text' },
          { label: 'Reply-To Address', placeholder: 'noreply@yourdomain.com', type: 'email' },
          { label: 'Daily Send Limit', placeholder: '5000', type: 'number' },
        ].map(f => (
          <div key={f.label}>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label}</label>
            <input
              type={f.type}
              placeholder={f.placeholder}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
        ))}
        <button
          className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
        >
          {saved ? 'Saved ✓' : 'Save Email Config'}
        </button>
      </div>
    </div>
  );
}

function DmarcTab() {
  const records = [
    { label: 'SPF Record', value: 'v=spf1 include:sendgrid.net ~all', status: 'Valid' },
    { label: 'DKIM Selector', value: 'nexus._domainkey.yourdomain.com', status: 'Valid' },
    { label: 'DMARC Policy', value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com', status: 'Valid' },
  ];
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">DMARC / DKIM</h2>
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm overflow-hidden">
        {records.map(r => (
          <div key={r.label} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 mb-1">{r.label}</p>
              <code className="text-[11px] text-slate-500 font-mono break-all">{r.value}</code>
            </div>
            <span className="flex-shrink-0 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              {r.status}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">DNS propagation can take up to 48 hours after updating records.</p>
    </div>
  );
}

function AgentConfigTab() {
  const [saved, setSaved] = React.useState(false);
  const [volumeThreshold, setVolumeThreshold] = useState('1000');
  const [confidenceThreshold, setConfidenceThreshold] = useState('95');
  const [warmupRate, setWarmupRate] = useState('500');

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Agent Guardrail Config</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
        {[
          { label: 'Volume Anomaly Threshold (emails/window)', value: volumeThreshold, onChange: setVolumeThreshold, hint: 'Dispatches above this count auto-escalate.' },
          { label: 'Confidence Score Minimum (%)', value: confidenceThreshold, onChange: setConfidenceThreshold, hint: 'LLM outputs below this score require human review.' },
          { label: 'Domain Warm-up Rate Cap (emails/hr)', value: warmupRate, onChange: setWarmupRate, hint: 'Applied to new sending domains during the 14-day warm-up.' },
        ].map(f => (
          <div key={f.label}>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label}</label>
            <input
              type="number"
              value={f.value}
              onChange={e => f.onChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <p className="text-xs text-slate-400 mt-1">{f.hint}</p>
          </div>
        ))}
        <button
          className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
        >
          {saved ? 'Saved ✓' : 'Save Agent Config'}
        </button>
      </div>
    </div>
  );
}

function RolesTab() {
  const roles = [
    { role: 'ACCOUNTING_AGENT', segment: 'Shareholders', permissions: ['SELECT', 'INSERT', 'DISPATCH'], color: 'indigo' },
    { role: 'BD_AGENT', segment: 'Business Partners', permissions: ['SELECT', 'INSERT', 'DISPATCH'], color: 'emerald' },
    { role: 'ADMIN_AGENT', segment: 'Gov Agencies', permissions: ['SELECT', 'INSERT', 'DISPATCH (approval required)'], color: 'amber' },
    { role: 'MIGRATION_AGENT', segment: 'All', permissions: ['INSERT on staging', 'PROMOTE to production'], color: 'slate' },
  ];
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Row-Level Security Roles</h2>
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm overflow-hidden">
        {roles.map(r => (
          <div key={r.role} className="px-5 py-4 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colorMap[r.color]}`}>{r.role}</span>
                <ChevronRight size={12} className="text-slate-300" />
                <span className="text-xs text-slate-500">{r.segment}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {r.permissions.map(p => (
                  <span key={p} className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{p}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">RLS policies are enforced at the PostgreSQL level. Role provisioning requires database admin access.</p>
    </div>
  );
}

export function NexusSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader />
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-slate-700 font-medium">Settings</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">Configure email delivery, agent guardrails, DMARC records, and role permissions.</p>
        </div>

        <div className="flex gap-6">
          {/* Sidebar nav */}
          <aside className="w-52 flex-shrink-0">
            <nav className="space-y-1">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeTab === 'general'  && <GeneralTab />}
            {activeTab === 'email'    && <EmailConfigTab />}
            {activeTab === 'dmarc'    && <DmarcTab />}
            {activeTab === 'agents'   && <AgentConfigTab />}
            {activeTab === 'roles'    && <RolesTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

export default NexusSettings;
