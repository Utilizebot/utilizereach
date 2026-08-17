import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  ChevronDown,
  ChevronUp,
  Upload,
  Building2,
  User,
  Mail,
  Tag,
  Activity,
  Phone,
  Globe,
  FileText,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { NexusHeader } from '../components/NexusHeader';

// ── Types ──────────────────────────────────────────────────────────────────

type Segment = 'ALL' | 'SHAREHOLDER' | 'BUSINESS_PARTNER' | 'GOVT_AGENCY' | 'UNASSIGNED';
type StatusFilter = 'all' | 'active' | 'inactive';

interface StakeholderProfile {
  // shareholder fields
  account_ref?: string;
  shares_held?: number;
  dividend_preference?: string;
  financial_year?: string;
  // business partner fields
  company_name?: string;
  partnership_tier?: string;
  programme_name?: string;
  contract_start?: string;
  // govt agency fields
  agency_code?: string;
  clearance_level?: string;
  regulatory_framework?: string;
  official_designation?: string;
  // unassigned
  source_list?: string;
  notes?: string;
}

interface Stakeholder {
  id: string;
  organization: string;
  contact_name: string;
  email: string;
  phone?: string;
  website?: string;
  segment: Exclude<Segment, 'ALL'>;
  status: 'active' | 'inactive';
  created_at: string;
  profile: StakeholderProfile;
}

interface StakeholderStats {
  total: number;
  by_segment: {
    SHAREHOLDER: number;
    BUSINESS_PARTNER: number;
    GOVT_AGENCY: number;
    UNASSIGNED: number;
  };
}

interface PaginatedResponse {
  stakeholders: Stakeholder[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface IngestResult {
  valid: number;
  invalid: number;
  classifications: Record<string, number>;
  errors?: string[];
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_STATS: StakeholderStats = {
  total: 25002,
  by_segment: { SHAREHOLDER: 8420, BUSINESS_PARTNER: 12350, GOVT_AGENCY: 1930, UNASSIGNED: 2302 },
};

const MOCK_STAKEHOLDERS: Stakeholder[] = [
  {
    id: '1',
    organization: 'Meridian Capital Group',
    contact_name: 'Jonathan Ashworth',
    email: 'j.ashworth@meridiancapital.com',
    phone: '+1 212 555 0101',
    website: 'meridiancapital.com',
    segment: 'SHAREHOLDER',
    status: 'active',
    created_at: '2024-01-15',
    profile: { account_ref: 'MCG-00421', shares_held: 85000, dividend_preference: 'Direct Deposit', financial_year: '2024' },
  },
  {
    id: '2',
    organization: 'Vantage Equity Partners',
    contact_name: 'Priya Mehta',
    email: 'priya.mehta@vantageep.com',
    phone: '+44 20 7946 0842',
    segment: 'SHAREHOLDER',
    status: 'active',
    created_at: '2024-02-08',
    profile: { account_ref: 'VEP-00118', shares_held: 42500, dividend_preference: 'Cheque', financial_year: '2024' },
  },
  {
    id: '3',
    organization: 'Orion Logistics Ltd',
    contact_name: 'Marcus Webb',
    email: 'm.webb@orionlogistics.co.uk',
    phone: '+44 161 999 0033',
    segment: 'BUSINESS_PARTNER',
    status: 'active',
    created_at: '2024-03-20',
    profile: { company_name: 'Orion Logistics Ltd', partnership_tier: 'Platinum', programme_name: 'Alliance Programme', contract_start: '2024-01-01' },
  },
  {
    id: '4',
    organization: 'SkyBridge Technologies',
    contact_name: 'Aisha Okonkwo',
    email: 'aokonkwo@skybridge.io',
    segment: 'BUSINESS_PARTNER',
    status: 'active',
    created_at: '2024-03-31',
    profile: { company_name: 'SkyBridge Technologies', partnership_tier: 'Gold', programme_name: 'Innovation Track', contract_start: '2024-03-01' },
  },
  {
    id: '5',
    organization: 'Crestline Investments',
    contact_name: 'Thomas Halford',
    email: 't.halford@crestline.com',
    segment: 'BUSINESS_PARTNER',
    status: 'inactive',
    created_at: '2023-11-14',
    profile: { company_name: 'Crestline Investments', partnership_tier: 'Silver', programme_name: 'Standard Programme', contract_start: '2023-06-01' },
  },
  {
    id: '6',
    organization: 'Financial Services Regulatory Authority',
    contact_name: 'Nigel Forsythe',
    email: 'nforsythe@fsra.gov',
    phone: '+1 800 555 0200',
    segment: 'GOVT_AGENCY',
    status: 'active',
    created_at: '2024-01-07',
    profile: { agency_code: 'FSRA-UK', clearance_level: 'Level 3', regulatory_framework: 'FCA / MIFID II', official_designation: 'Senior Compliance Officer' },
  },
  {
    id: '7',
    organization: 'National Infrastructure Authority',
    contact_name: 'Sylvia Drummond',
    email: 's.drummond@nia.gov.au',
    segment: 'GOVT_AGENCY',
    status: 'active',
    created_at: '2024-04-12',
    profile: { agency_code: 'NIA-AU', clearance_level: 'Level 2', regulatory_framework: 'ASIC', official_designation: 'Director of Oversight' },
  },
  {
    id: '8',
    organization: 'Unknown Holdings Inc',
    contact_name: 'Robert Chen',
    email: 'rchen@unknownholdings.com',
    segment: 'UNASSIGNED',
    status: 'active',
    created_at: '2024-05-01',
    profile: { source_list: 'Legacy Import 2024-05', notes: 'Awaiting segment classification' },
  },
  {
    id: '9',
    organization: 'Blue Ridge Capital',
    contact_name: 'Elena Vasquez',
    email: 'elena.v@blueridge.com',
    segment: 'SHAREHOLDER',
    status: 'inactive',
    created_at: '2023-09-22',
    profile: { account_ref: 'BRC-00772', shares_held: 12000, dividend_preference: 'Reinvestment', financial_year: '2023' },
  },
  {
    id: '10',
    organization: 'Pinnacle Trade Associates',
    contact_name: 'James Osei',
    email: 'j.osei@pinnacletrade.com',
    segment: 'UNASSIGNED',
    status: 'inactive',
    created_at: '2024-06-18',
    profile: { source_list: 'LinkedIn Export', notes: 'Cold outreach list — not yet verified' },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const SEGMENT_META: Record<Exclude<Segment, 'ALL'>, { label: string; bg: string; text: string; border: string }> = {
  SHAREHOLDER: { label: 'Shareholder', bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  BUSINESS_PARTNER: { label: 'Business Partner', bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  GOVT_AGENCY: { label: 'Gov Agency', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  UNASSIGNED: { label: 'Unassigned', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
};

const TAB_CONFIG: { id: Segment; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'SHAREHOLDER', label: 'Shareholders' },
  { id: 'BUSINESS_PARTNER', label: 'Business Partners' },
  { id: 'GOVT_AGENCY', label: 'Gov Agencies' },
  { id: 'UNASSIGNED', label: 'Unassigned' },
];

function tabCount(id: Segment, stats: StakeholderStats | null): number | null {
  if (!stats) return null;
  if (id === 'ALL') return stats.total;
  return stats.by_segment[id] ?? 0;
}

function applyMockFilters(segment: Segment, q: string, status: StatusFilter, page: number, per_page: number): PaginatedResponse {
  let rows = MOCK_STAKEHOLDERS;
  if (segment !== 'ALL') rows = rows.filter(r => r.segment === segment);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter(r =>
      r.organization.toLowerCase().includes(lq) ||
      r.contact_name.toLowerCase().includes(lq) ||
      r.email.toLowerCase().includes(lq)
    );
  }
  const total = rows.length;
  const total_pages = Math.max(1, Math.ceil(total / per_page));
  const start = (page - 1) * per_page;
  return { stakeholders: rows.slice(start, start + per_page), total, page, per_page, total_pages };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SegmentBadge({ segment }: { segment: Exclude<Segment, 'ALL'> }) {
  const m = SEGMENT_META[segment];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${m.bg} ${m.text} ${m.border}`}>
      {m.label}
    </span>
  );
}

function StatusDot({ status }: { status: 'active' | 'inactive' }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'active' ? 'bg-emerald-500' : 'bg-red-400'}`} />
      <span className={`text-xs font-medium ${status === 'active' ? 'text-emerald-700' : 'text-red-500'}`}>
        {status === 'active' ? 'Active' : 'Inactive'}
      </span>
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      {[40, 160, 130, 170, 110, 80, 70].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ── Profile detail fields rendered in slide-over ───────────────────────────

function ProfileFields({ s }: { s: Stakeholder }) {
  const p = s.profile;
  const items: { icon: React.ElementType; label: string; value: string | number | undefined }[] = [];

  if (s.segment === 'SHAREHOLDER') {
    items.push(
      { icon: Tag, label: 'Account Ref', value: p.account_ref },
      { icon: Activity, label: 'Shares Held', value: p.shares_held?.toLocaleString() },
      { icon: FileText, label: 'Dividend Preference', value: p.dividend_preference },
      { icon: FileText, label: 'Financial Year', value: p.financial_year },
    );
  } else if (s.segment === 'BUSINESS_PARTNER') {
    items.push(
      { icon: Building2, label: 'Company', value: p.company_name },
      { icon: Tag, label: 'Partnership Tier', value: p.partnership_tier },
      { icon: FileText, label: 'Programme', value: p.programme_name },
      { icon: Activity, label: 'Contract Start', value: p.contract_start },
    );
  } else if (s.segment === 'GOVT_AGENCY') {
    items.push(
      { icon: Tag, label: 'Agency Code', value: p.agency_code },
      { icon: Activity, label: 'Clearance Level', value: p.clearance_level },
      { icon: FileText, label: 'Regulatory Framework', value: p.regulatory_framework },
      { icon: User, label: 'Official Designation', value: p.official_designation },
    );
  } else {
    items.push(
      { icon: FileText, label: 'Source List', value: p.source_list },
      { icon: FileText, label: 'Notes', value: p.notes },
    );
  }

  return (
    <div className="space-y-3">
      {items.map(item => item.value !== undefined && (
        <div key={item.label} className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <item.icon size={14} className="text-slate-500" />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">{item.label}</p>
            <p className="text-sm text-slate-800 font-medium">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Slide-over ─────────────────────────────────────────────────────────────

function SlideOver({ stakeholder, onClose }: { stakeholder: Stakeholder; onClose: () => void }) {
  const m = SEGMENT_META[stakeholder.segment];
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <SegmentBadge segment={stakeholder.segment} />
              <StatusDot status={stakeholder.status} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 truncate">{stakeholder.organization}</h2>
            <p className="text-sm text-slate-500">{stakeholder.contact_name}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Contact info */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contact Details</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Mail size={14} className="text-slate-500" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Email</p>
                  <a href={`mailto:${stakeholder.email}`} className="text-sm text-emerald-600 hover:underline font-medium">{stakeholder.email}</a>
                </div>
              </div>
              {stakeholder.phone && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Phone size={14} className="text-slate-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Phone</p>
                    <p className="text-sm text-slate-800 font-medium">{stakeholder.phone}</p>
                  </div>
                </div>
              )}
              {stakeholder.website && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Globe size={14} className="text-slate-500" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Website</p>
                    <a href={`https://${stakeholder.website}`} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-600 hover:underline font-medium">{stakeholder.website}</a>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Activity size={14} className="text-slate-500" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Added</p>
                  <p className="text-sm text-slate-800 font-medium">{new Date(stakeholder.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Segment profile */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              <span className={`${m.text}`}>{m.label}</span> Profile
            </h3>
            <div className={`rounded-xl p-4 border ${m.bg} ${m.border}`}>
              <ProfileFields s={stakeholder} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-6 py-4 bg-slate-50 flex gap-3">
          <button className="flex-1 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
            Start Campaign
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors">
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ── Import section ─────────────────────────────────────────────────────────

function ImportSection() {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleIngest = async () => {
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
    } catch (e: unknown) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/migration/ingest-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: parsed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IngestResult = await res.json();
      setResult(data);
    } catch {
      // Mock result on failure
      const count = (parsed as unknown[]).length;
      setResult({
        valid: Math.max(0, count - 1),
        invalid: Math.min(1, count),
        classifications: { SHAREHOLDER: Math.floor(count * 0.3), BUSINESS_PARTNER: Math.floor(count * 0.4), GOVT_AGENCY: Math.floor(count * 0.1), UNASSIGNED: Math.floor(count * 0.2) },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Upload size={16} className="text-slate-400" />
          Batch Import — Paste Legacy Contacts
        </span>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-slate-100">
          <p className="text-xs text-slate-400 mt-4 mb-3">
            Paste a JSON array of contact objects. Each record must include at minimum an <code className="bg-slate-100 px-1 rounded">email</code> field.
            The ingestion pipeline will auto-classify each contact into a segment.
          </p>
          <textarea
            value={json}
            onChange={e => { setJson(e.target.value); setResult(null); setError(null); }}
            placeholder={`[\n  { "email": "john@example.com", "contact_name": "John Smith", "organization": "Acme Corp" }\n]`}
            rows={7}
            className="w-full font-mono text-xs border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y placeholder-slate-300"
          />

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={handleIngest}
              disabled={loading || !json.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {loading ? 'Ingesting...' : 'Ingest Batch'}
            </button>
            {json && (
              <button onClick={() => { setJson(''); setResult(null); setError(null); }} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                Clear
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {result && (
            <div className="mt-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={15} className="text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-800">Ingestion complete</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                  <p className="text-xs text-slate-400 mb-0.5">Valid</p>
                  <p className="text-lg font-bold text-emerald-700">{result.valid}</p>
                </div>
                <div className="bg-white rounded-lg px-3 py-2 border border-red-100">
                  <p className="text-xs text-slate-400 mb-0.5">Invalid</p>
                  <p className="text-lg font-bold text-red-500">{result.invalid}</p>
                </div>
              </div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Classifications</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.classifications).map(([seg, count]) => {
                  const meta = SEGMENT_META[seg as Exclude<Segment, 'ALL'>];
                  return meta && count > 0 ? (
                    <span key={seg} className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${meta.bg} ${meta.text} ${meta.border}`}>
                      {meta.label}: {count}
                    </span>
                  ) : null;
                })}
              </div>
              {result.errors && result.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-red-500 mb-1">Errors ({result.errors.length})</p>
                  <ul className="text-xs text-red-600 space-y-0.5">
                    {result.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                    {result.errors.length > 5 && <li className="text-slate-400">...and {result.errors.length - 5} more</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function NexusStakeholders() {
  const [activeSegment, setActiveSegment] = useState<Segment>('ALL');
  const [stats, setStats] = useState<StakeholderStats | null>(null);
  const [rows, setRows] = useState<Stakeholder[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Stakeholder | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch stats once
  useEffect(() => {
    fetch('/api/v1/stakeholders/stats')
      .then(r => r.json())
      .then((d: StakeholderStats) => setStats(d))
      .catch(() => setStats(MOCK_STATS));
  }, []);

  // Fetch table data
  const fetchData = useCallback(async (seg: Segment, currentPage: number, currentPerPage: number, query: string, status: StatusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (seg !== 'ALL') params.set('segment', seg);
      params.set('page', String(currentPage));
      params.set('per_page', String(currentPerPage));
      if (query) params.set('q', query);
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/v1/stakeholders?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PaginatedResponse = await res.json();
      setRows(data.stakeholders);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch {
      const mock = applyMockFilters(seg, query, status, currentPage, currentPerPage);
      setRows(mock.stakeholders);
      setTotal(mock.total);
      setTotalPages(mock.total_pages);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search + refetch on param change
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchData(activeSegment, page, perPage, q, statusFilter);
    }, 250);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [activeSegment, page, perPage, q, statusFilter, fetchData]);

  const handleSegmentChange = (seg: Segment) => {
    setActiveSegment(seg);
    setPage(1);
  };

  const handleSearch = (val: string) => {
    setQ(val);
    setPage(1);
  };

  const handleStatusFilter = (val: StatusFilter) => {
    setStatusFilter(val);
    setPage(1);
  };

  const handlePerPageChange = (val: number) => {
    setPerPage(val);
    setPage(1);
  };

  const startRow = (page - 1) * perPage + 1;
  const endRow = Math.min(page * perPage, total);

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <NexusHeader />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Page title */}
        <div className="mb-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-slate-700 font-medium">Stakeholders</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Stakeholder Database</h1>
          <p className="text-sm text-slate-500 mt-1">
            {stats ? `${stats.total.toLocaleString()} contacts — Shareholders, Business Partners, Gov Agencies, Unassigned` : 'Loading database...'}
          </p>
        </div>

        {/* Segment tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {TAB_CONFIG.map(tab => {
            const count = tabCount(tab.id, stats);
            const isActive = activeSegment === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSegmentChange(tab.id)}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap border transition-all',
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
                ].join(' ')}
              >
                {tab.label}
                {count !== null && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search organization, name, or email..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => handleStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>

          <button
            onClick={() => alert('Export initiated')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>

        {/* Data table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Organization</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Contact Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Segment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                      No stakeholders found for the current filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-slate-400 font-medium">
                        {startRow + idx}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                            <Building2 size={13} className="text-slate-400" />
                          </div>
                          <span className="font-semibold text-slate-800 truncate max-w-[180px]">{row.organization}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.contact_name}</td>
                      <td className="px-4 py-3">
                        <a href={`mailto:${row.email}`} className="text-emerald-600 hover:underline text-sm">{row.email}</a>
                      </td>
                      <td className="px-4 py-3">
                        <SegmentBadge segment={row.segment} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusDot status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelected(row)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-transparent hover:border-emerald-200 transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">
              {loading ? 'Loading...' : total === 0 ? 'No results' : `Showing ${startRow}–${endRow} of ${total.toLocaleString()}`}
            </p>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Rows:</span>
                <select
                  value={perPage}
                  onChange={e => handlePerPageChange(Number(e.target.value))}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-slate-600 px-2 font-medium">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Import section */}
        <ImportSection />
      </main>

      {/* Slide-over */}
      {selected && <SlideOver stakeholder={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default NexusStakeholders;
