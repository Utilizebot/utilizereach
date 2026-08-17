import { useState } from 'react';
import {
  Briefcase,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  FileText,
  Landmark,
  Layers,
  Send,
  Shield,
  AlertTriangle,
  Hash,
  Zap,
} from 'lucide-react';
import { NexusHeader } from '../components/NexusHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentKey = 'bd' | 'admin';
type SegmentKey = 'shareholders' | 'partners' | 'gov';
type ScheduleMode = 'now' | 'scheduled';

interface Template {
  id: string;
  name: string;
  agent: AgentKey;
  lastUsed: string;
  icon: React.ElementType;
  subject: string;
  body: string;
}

interface LaunchResult {
  status: 'autonomous' | 'escalated';
  approvalId?: string;
}

// ── Static data ───────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  // BD Agent
  {
    id: 'bd-1', name: 'Partnership Outreach', agent: 'bd', lastUsed: '2026-08-11', icon: Briefcase,
    subject: 'Partnership Opportunity — {{company_name}} × {{our_company}}',
    body: `Dear {{partner_name}},

I hope this message finds you well. Following our recent conversations, I wanted to reach out formally regarding a {{partnership_tier}} partnership opportunity between {{company_name}} and {{our_company}}.

We believe your organisation would be an excellent fit for our {{programme_name}} programme, particularly given your expertise in {{partner_focus_area}}.

Benefits of joining:
• Dedicated account management from our BD team
• Access to our network of {{network_size}} industry contacts
• Co-marketing opportunities and joint thought leadership

Would you be open to a 30-minute discovery call this week? I have availability on {{proposed_date}}.

Best regards,
{{sender_name}}
BD Agent — Nexus Engine`,
  },
  {
    id: 'bd-2', name: 'Follow-up Cadence Day 3', agent: 'bd', lastUsed: '2026-08-09', icon: Clock,
    subject: 'Following up — {{campaign_name}}',
    body: `Hi {{partner_name}},

Just circling back on my note from {{initial_contact_date}} regarding the {{programme_name}} opportunity.

I understand you're busy — I'll keep this brief. We've had strong interest from {{industry}} companies similar to {{company_name}}, and I wanted to make sure you didn't miss the window for Q{{current_quarter}} onboarding.

Is this still on your radar? A quick yes/no reply is all I need.

Regards,
{{sender_name}}
BD Agent — Nexus Engine`,
  },
  {
    id: 'bd-3', name: 'Commercial Proposal', agent: 'bd', lastUsed: '2026-08-02', icon: Layers,
    subject: 'Commercial Proposal — {{programme_name}} ({{proposal_ref}})',
    body: `Dear {{partner_name}},

Please find attached our formal commercial proposal for the {{programme_name}} engagement, reference {{proposal_ref}}.

Proposal summary:
• Commercial Tier: {{commercial_tier}}
• Contract Duration: {{contract_duration}}
• Commencement Date: {{start_date}}
• Annual Value: {{contract_value}}

This proposal is valid until {{expiry_date}}. Should you have questions or wish to negotiate any terms, please contact us directly.

To proceed, please sign and return the attached NDA before {{nda_deadline}}.

Kind regards,
{{sender_name}}
BD Agent — Nexus Engine`,
  },
  // Admin Agent
  {
    id: 'adm-1', name: 'Regulatory Filing Notice', agent: 'admin', lastUsed: '2026-08-08', icon: Landmark,
    subject: 'Regulatory Filing Notice — {{regulatory_framework}} (Ref: {{filing_ref}})',
    body: `Attention: {{official_designation}},

This is an official communication from {{company_name}} regarding our obligations under {{regulatory_framework}}.

Filing Details:
• Reference: {{filing_ref}}
• Jurisdiction: {{jurisdiction_level}}
• Deadline: {{deadline_date}}
• Agency Code: {{agency_code}}

Please acknowledge receipt of this notice by {{acknowledgement_deadline}}. Should you require additional documentation or clarification, contact {{compliance_contact}} at {{compliance_email}}.

This communication is generated and dispatched by the Nexus Autonomous Admin Agent under clearance level {{clearance_level_required}}.

Regards,
{{company_name}} Compliance Office
Admin Agent — Nexus Engine`,
  },
  {
    id: 'adm-2', name: 'Compliance Update', agent: 'admin', lastUsed: '2026-07-30', icon: Shield,
    subject: 'Compliance Update — {{regulatory_framework}} Amendment {{amendment_no}}',
    body: `Dear {{official_designation}},

We are writing to inform you of updates to our compliance posture under {{regulatory_framework}}, effective {{effective_date}}.

Key Changes:
• {{change_1}}
• {{change_2}}
• {{change_3}}

Our updated compliance documentation (Ref: {{doc_ref}}) has been filed with {{agency_code}} on {{filing_date}}.

No action is required from your office at this time. This notice is provided for your records in accordance with {{statutory_requirement}}.

Admin Agent — Nexus Engine`,
  },
  {
    id: 'adm-3', name: 'Official Correspondence', agent: 'admin', lastUsed: '2026-07-20', icon: FileText,
    subject: '{{correspondence_subject}} — {{company_name}} ({{correspondence_ref}})',
    body: `To: {{official_designation}}
Agency: {{agency_name}} ({{agency_code}})
Date: {{correspondence_date}}
Reference: {{correspondence_ref}}

Dear {{official_designation}},

{{company_name}} submits this official correspondence in response to {{original_notice_ref}} dated {{notice_date}}.

Matter: {{correspondence_subject}}

{{correspondence_body}}

We trust this satisfies your requirements. Should further information be needed, please direct enquiries to {{legal_contact}} within {{response_window}} business days.

Yours sincerely,
{{signatory_name}}
{{signatory_title}}
{{company_name}}

Admin Agent — Nexus Engine`,
  },
];

const AGENT_META: Record<AgentKey, { label: string; description: string; color: string; bg: string; dot: string }> = {
  bd: {
    label: 'BD Agent',
    description: 'Partner outreach, follow-up cadences, commercial proposals — relationship-driven sequences.',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  admin: {
    label: 'Admin Agent',
    description: 'Regulatory filings, compliance notices, official government correspondence — audit-grade precision.',
    color: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-300',
    dot: 'bg-amber-500',
  },
};

const AGENT_BADGE: Record<AgentKey, string> = {
  bd:    'bg-emerald-100 text-emerald-700',
  admin: 'bg-amber-100 text-amber-700',
};

const SEGMENT_OPTIONS: { value: SegmentKey; label: string }[] = [
  { value: 'shareholders', label: 'Shareholders' },
  { value: 'partners',     label: 'Business Partners' },
  { value: 'gov',          label: 'Gov Agencies' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Template preview ──────────────────────────────────────────────────────────

function TemplatePreview({ template }: { template: Template }) {
  const agentMeta = AGENT_META[template.agent];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Template Preview</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${AGENT_BADGE[template.agent]}`}>
          {agentMeta.label}
        </span>
      </div>

      {/* Subject line */}
      <div className="mb-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-2">Subject</span>
        <span className="text-xs text-slate-700 font-medium">
          {template.subject.split(/({{[^}]+}})/).map((part, i) =>
            part.startsWith('{{')
              ? <span key={i} className="text-emerald-600 font-semibold">{part}</span>
              : <span key={i}>{part}</span>
          )}
        </span>
      </div>

      {/* Body */}
      <div className="bg-slate-900 rounded-lg p-3 overflow-auto max-h-64">
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono" style={{ color: '#94A3B8' }}>
          {template.body.split(/({{[^}]+}})/).map((part, i) =>
            part.startsWith('{{')
              ? <span key={i} style={{ color: '#34D399', fontWeight: 600 }}>{part}</span>
              : part
          )}
        </pre>
      </div>

      <p className="text-[10px] text-slate-400 mt-2">
        AI variables <span className="text-emerald-600 font-semibold">{'{{highlighted}}'}</span> are auto-populated at dispatch.
      </p>
    </div>
  );
}

// ── Template Library (left panel) ────────────────────────────────────────────

interface TemplateLibraryProps {
  selected: string | null;
  onSelect: (t: Template) => void;
}

function TemplateLibrary({ selected, onSelect }: TemplateLibraryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const groups: AgentKey[] = ['bd', 'admin'];

  function handleClick(t: Template) {
    // Toggle preview open/closed; always notify parent of selection
    setExpandedId(prev => (prev === t.id ? null : t.id));
    onSelect(t);
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Template Library</h2>
        <p className="text-xs text-slate-400 mt-0.5">Click a template to preview and select it</p>
      </div>

      <div className="space-y-5">
        {groups.map(agentKey => {
          const meta = AGENT_META[agentKey];
          const templates = TEMPLATES.filter(t => t.agent === agentKey);
          return (
            <div key={agentKey}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className="text-xs font-semibold text-slate-600">{meta.label}</span>
              </div>

              <div className="space-y-2">
                {templates.map(t => {
                  const Icon = t.icon;
                  const isChosen = selected === t.id;
                  const isOpen   = expandedId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={[
                        'rounded-xl border transition-all cursor-pointer',
                        isChosen ? 'border-emerald-400 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
                        isOpen   ? 'bg-slate-50' : 'bg-white',
                      ].join(' ')}
                      onClick={() => handleClick(t)}
                    >
                      {/* Always-visible header row */}
                      <div className="flex items-start gap-3 p-3">
                        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${isChosen ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                          <Icon size={15} className={isChosen ? 'text-emerald-600' : 'text-slate-500'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-medium text-slate-800 truncate">{t.name}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${AGENT_BADGE[t.agent]}`}>
                              {AGENT_META[t.agent].label.replace(' Agent', '')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Clock size={10} />{formatDate(t.lastUsed)}
                            </span>
                            <span className={`text-[11px] font-semibold ${isChosen ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {isOpen ? '▲ Hide preview' : isChosen ? '✓ Selected' : '▼ Preview'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Preview panel — toggled by local expandedId */}
                      {isOpen && (
                        <div
                          className="border-t border-slate-200 px-3 pt-3 pb-3"
                          onClick={e => e.stopPropagation()}
                        >
                          <TemplatePreview template={t} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 focus:outline-none"
      aria-label={label}
    >
      <div className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NexusCampaignBuilder() {
  // Template
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Form state
  const [campaignName, setCampaignName]     = useState('');
  const [selectedAgent, setSelectedAgent]   = useState<AgentKey>('bd');
  const [segment, setSegment]               = useState<SegmentKey>('shareholders');
  const [scheduleMode, setScheduleMode]     = useState<ScheduleMode>('now');
  const [scheduledAt, setScheduledAt]       = useState('');
  const [autoExecute, setAutoExecute]       = useState(true);
  const [volumeOverride, setVolumeOverride] = useState('');

  // Launch state
  const [launching, setLaunching]       = useState(false);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [launchError, setLaunchError]   = useState<string | null>(null);

  function handleSelectTemplate(t: Template) {
    setSelectedTemplateId(t.id);
    setSelectedAgent(t.agent);
    if (!campaignName) setCampaignName(t.name);
  }

  async function handleLaunch() {
    if (!campaignName.trim()) return;
    setLaunching(true);
    setLaunchResult(null);
    setLaunchError(null);

    const payload = {
      campaign_name:   campaignName,
      agent:           selectedAgent,
      segment,
      schedule_mode:   scheduleMode,
      scheduled_at:    scheduleMode === 'scheduled' ? scheduledAt : null,
      auto_execute:    autoExecute,
      volume_override: volumeOverride ? parseInt(volumeOverride, 10) : null,
      template_id:     selectedTemplateId,
    };

    try {
      const res = await fetch('/api/v1/agents/workflows/trigger', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setLaunchResult({
          status:     data.auto_execute ? 'autonomous' : 'escalated',
          approvalId: data.approval_id,
        });
      } else {
        // Simulate deterministic mock response
        const mock = autoExecute
          ? { status: 'autonomous' as const }
          : { status: 'escalated' as const, approvalId: `APV-${Math.floor(Math.random() * 90000 + 10000)}` };
        setLaunchResult(mock);
      }
    } catch {
      const mock = autoExecute
        ? { status: 'autonomous' as const }
        : { status: 'escalated' as const, approvalId: `APV-${Math.floor(Math.random() * 90000 + 10000)}` };
      setLaunchResult(mock);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page header breadcrumb */}
        <div className="mb-8">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-slate-700 font-medium">Campaign Builder</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Campaign Builder</h1>
          <p className="text-sm text-slate-500 mt-1">Select a template, configure your agent, and launch autonomous outreach campaigns.</p>
        </div>

        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

          {/* LEFT: Template Library */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm self-start">
            <TemplateLibrary selected={selectedTemplateId} onSelect={handleSelectTemplate} />
          </div>

          {/* RIGHT: Campaign Configuration */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-7">

            {/* Campaign Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Campaign Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g. Q3 Dividend Notice — August 2026"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition"
              />
            </div>

            {/* Agent Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Agent</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(Object.keys(AGENT_META) as AgentKey[]).map(key => {
                  const meta = AGENT_META[key];
                  const active = selectedAgent === key;
                  return (
                    <label
                      key={key}
                      className={[
                        'flex flex-col gap-1.5 rounded-xl border-2 p-3.5 cursor-pointer transition-all',
                        active ? meta.bg + ' shadow-sm' : 'border-slate-200 hover:border-slate-300',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="agent"
                          value={key}
                          checked={active}
                          onChange={() => setSelectedAgent(key)}
                          className="accent-emerald-500"
                        />
                        <span className={`text-sm font-semibold ${active ? meta.color : 'text-slate-700'}`}>{meta.label}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed pl-5">{meta.description}</p>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Recipient Segment */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Recipient Segment</label>
              <div className="relative">
                <select
                  value={segment}
                  onChange={e => setSegment(e.target.value as SegmentKey)}
                  className="w-full appearance-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition bg-white pr-10"
                >
                  {SEGMENT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* Schedule */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Schedule</label>
              <div className="flex items-center gap-3 mb-3">
                {(['now', 'scheduled'] as ScheduleMode[]).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setScheduleMode(mode)}
                    className={[
                      'flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all',
                      scheduleMode === mode
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400',
                    ].join(' ')}
                  >
                    {mode === 'now' ? <Send size={13} /> : <Calendar size={13} />}
                    {mode === 'now' ? 'Send Now' : 'Scheduled'}
                  </button>
                ))}
              </div>

              {scheduleMode === 'scheduled' && (
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition"
                />
              )}
            </div>

            {/* Auto-Execute Toggle */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-slate-700">Auto-Execute</span>
                  <p className="text-xs text-slate-400 mt-0.5">Allow the agent to dispatch without human review</p>
                </div>
                <Toggle on={autoExecute} onChange={setAutoExecute} label={autoExecute ? 'On' : 'Off'} />
              </div>
              {!autoExecute && (
                <div className="mt-2.5 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-amber-700 font-medium">Human review required before dispatch</span>
                </div>
              )}
            </div>

            {/* Volume Override */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Hash size={14} className="text-slate-400" />
                <label className="text-sm font-semibold text-slate-700">
                  Volume Override
                  <span className="text-xs font-normal text-slate-400 ml-1">(optional)</span>
                </label>
              </div>
              <input
                type="number"
                value={volumeOverride}
                onChange={e => setVolumeOverride(e.target.value)}
                placeholder="Auto-detect from segment"
                min={1}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition"
              />
            </div>

            {/* Confidence Score */}
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Zap size={14} className="text-emerald-500" />
                <span className="font-medium">Confidence Score</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-28 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: '97%' }} />
                </div>
                <span className="text-sm font-semibold text-emerald-700">97.0%</span>
                <span className="text-xs text-slate-400">— within threshold</span>
              </div>
            </div>

            {/* Launch Button */}
            <div>
              <button
                type="button"
                onClick={handleLaunch}
                disabled={launching || !campaignName.trim()}
                className={[
                  'w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all',
                  launching || !campaignName.trim()
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:shadow-lg active:scale-[.99]',
                ].join(' ')}
              >
                {launching ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Launching…
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Launch Campaign
                  </>
                )}
              </button>
            </div>

            {/* Status Banner */}
            {launchResult && (
              <div
                className={[
                  'flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-medium',
                  launchResult.status === 'autonomous'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-amber-50 border-amber-300 text-amber-800',
                ].join(' ')}
              >
                {launchResult.status === 'autonomous' ? (
                  <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
                )}
                {launchResult.status === 'autonomous'
                  ? 'Autonomously Dispatched — campaign is live.'
                  : `Escalated — awaiting approval (ID: ${launchResult.approvalId})`}
              </div>
            )}

            {launchError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                {launchError}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
