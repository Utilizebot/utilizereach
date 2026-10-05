import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Megaphone, Plus, X, Users, Eye, MousePointerClick, MessageCircle, Mail,
  TrendingUp, Play, Pause, Trophy, ChevronRight, Loader2, Target, Clock,
} from 'lucide-react';
import { EmailDetailModal } from '../components/EmailDetailModal';
import { FollowupEditor, type Followup } from '../components/FollowupEditor';
import { useAuth } from '../hooks/useAuth';
import { useConfig, useConfigContext } from '../context/ConfigContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Campaign {
  id: string; name: string; description?: string; segment?: string; status: string;
  target_count: number; daily_cap?: number; variant_count: number; created_at?: string;
  progress: number; sent: number; opened: number; clicked: number; replied: number;
  open_rate: number; click_rate: number; reply_rate: number;
  followup_count?: number; followup_engaged_only?: boolean; account_manager?: string;
}
interface Seg { key: string; label: string; color?: string; lead_count?: number; }

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Host part of a website URL for display ("https://www.acme.com/x" -> "www.acme.com"). */
const websiteHost = (url: string) => {
  try { return new URL(url).host; } catch { return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''); }
};

/** Neutral starter copy in the active brand's own name (used for every brand). */
function starterVariants(brandName: string, website: string) {
  const name = escapeHtml(brandName || 'our team');
  const team = brandName ? `The ${name} Team` : 'The Team';
  const safeUrl = /^https?:\/\//i.test(website) ? escapeHtml(website) : '';
  const body =
    "<p>Hi {first_name},</p>" +
    `<p>I'm reaching out from ${name} because I think what we do could be a genuine fit for {company}.</p>` +
    "<p>[Describe what you offer and the main benefit for the reader in one or two sentences.]</p>" +
    (safeUrl
      ? `<p>Open to a short call? You can <a href="${safeUrl}">learn more here</a>.</p>`
      : "<p>Open to a short call? Just reply to this email and we'll find a time.</p>") +
    `<p>Warm regards,<br>${team}</p>` +
    (safeUrl ? `<p style="color:#888;font-size:12px">${escapeHtml(websiteHost(website))}</p>` : '');
  const subjectName = brandName || 'us';
  return [
    { label: 'A', subject: `Quick question from ${subjectName}`, body },
    { label: 'B', subject: 'An idea for your team', body },
  ];
}

const statusColor = (s: string) =>
  s === 'active' ? 'bg-emerald-100 text-emerald-700'
    : s === 'paused' ? 'bg-amber-100 text-amber-700'
    : s === 'completed' ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-600';

export function Campaigns() {
  const { can } = useAuth();
  const canCreate = can('campaigns.create');
  const canEdit = can('campaigns.edit');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/campaigns/list`, { cache: 'no-store' }),
        fetch(`${API_BASE}/api/segments/`, { cache: 'no-store' }),
      ]);
      const c = await cRes.json();
      const s = await sRes.json();
      setCampaigns(c.campaigns || []);
      setSegments(s.segments || []);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const setStatus = async (id: string, status: string) => {
    await fetch(`${API_BASE}/api/campaigns/${id}/set-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchAll();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-fuchsia-600 to-purple-600 flex items-center justify-center shadow-lg">
            <Megaphone className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
            <p className="text-sm text-gray-500">Monitor each campaign, compare A/B variants, track the team</p>
          </div>
        </div>
        {canCreate && (
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white font-medium shadow hover:shadow-lg transition-all">
          <Plus className="h-4 w-4" /> New Campaign
        </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <Megaphone className="h-14 w-14 text-gray-300 mx-auto mb-4" />
          <p className="text-lg font-semibold text-gray-800">No campaigns yet</p>
          <p className="text-sm text-gray-500 mt-1 mb-5">Create one to target a segment with A/B-tested emails, sent at your warmup pace.</p>
          {canCreate && <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white font-medium">Create your first campaign</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {campaigns.map((c) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
              onClick={() => setOpenId(c.id)}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{c.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{c.segment || 'no segment'} · {c.variant_count} variant{c.variant_count === 1 ? '' : 's'}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusColor(c.status)}`}>{c.status}</span>
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{c.sent} / {c.target_count} sent</span><span>{c.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-fuchsia-500 to-purple-600" style={{ width: `${Math.min(100, c.progress)}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                  <Stat icon={<Eye className="h-4 w-4" />} label="Open" val={`${c.open_rate}%`} tone="text-amber-600" />
                  <Stat icon={<MousePointerClick className="h-4 w-4" />} label="Click" val={`${c.click_rate}%`} tone="text-blue-600" />
                  <Stat icon={<MessageCircle className="h-4 w-4" />} label="Reply" val={`${c.reply_rate}%`} tone="text-emerald-600" />
                </div>
                {c.followup_count ? (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 text-indigo-600 font-medium"><Clock className="h-3.5 w-3.5" />{c.followup_count} follow-up{c.followup_count === 1 ? '' : 's'}</span>
                    {c.followup_engaged_only && <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-semibold uppercase tracking-wide">Engaged only</span>}
                  </div>
                ) : null}
                {c.account_manager && (
                  <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-semibold capitalize">AM · {c.account_manager}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {!canEdit ? null : c.status === 'active'
                    ? <button onClick={() => setStatus(c.id, 'paused')} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600" title="Pause"><Pause className="h-4 w-4" /></button>
                    : <button onClick={() => setStatus(c.id, 'active')} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600" title="Activate"><Play className="h-4 w-4" /></button>}
                </div>
                <span className="flex items-center gap-1 text-sm text-purple-600 font-medium">View <ChevronRight className="h-4 w-4" /></span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && canCreate && <CreateModal segments={segments} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchAll(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {openId && <DetailModal id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Stat({ icon, label, val, tone }: { icon: React.ReactNode; label: string; val: string; tone: string }) {
  return (
    <div className="rounded-xl bg-gray-50 py-2">
      <div className={`flex items-center justify-center gap-1 ${tone}`}>{icon}<span className="font-bold text-sm">{val}</span></div>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function CreateModal({ segments, onClose, onCreated }: { segments: Seg[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [segment, setSegment] = useState(segments[0]?.key || '');
  const [target, setTarget] = useState(100);
  const [dailyCap, setDailyCap] = useState(20);
  // Every brand gets neutral starter copy in its own name / website. With no
  // active brand (older backend) the dashboard config is the brand's config.
  const { activeBrand } = useAuth();
  const config = useConfig();
  const { activeBrandRow } = useConfigContext();
  // Only trust the dashboard config's identity once it belongs to this brand.
  const configIsBrand = !activeBrand || activeBrandRow?.id === activeBrand.id;
  const brandWebsite = configIsBrand ? (config.company.website || '') : '';
  const brandName = (configIsBrand ? config.company.name : '') || activeBrand?.display_name || '';
  const [variants, setVariants] = useState(() => starterVariants(brandName, brandWebsite));
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [engaged, setEngaged] = useState(true);
  const [am, setAm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/campaigns/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, segment, target_count: target, daily_cap: dailyCap, variants, followups, followup_engaged_only: engaged, account_manager: am.trim() || null, status: 'active' }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create'); }
    setSaving(false);
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl my-4"
        initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-lg">New Campaign</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Campaign name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Malaysia Execs — Batch 1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Segment</label>
              <select value={segment} onChange={(e) => setSegment(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                {segments.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.lead_count ?? 0})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Target</label>
              <input type="number" value={target} onChange={(e) => setTarget(+e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Emails/day</label>
              <input type="number" value={dailyCap} onChange={(e) => setDailyCap(+e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2"><Trophy className="h-4 w-4 text-fuchsia-600" /><span className="text-sm font-semibold text-gray-700">A/B Variants</span>
              <span className="text-xs text-gray-400">split evenly · {'{first_name}'} and {'{company}'} auto-fill</span></div>
            <div className="space-y-3">
              {variants.map((v, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50/60">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-6 w-6 rounded-full bg-fuchsia-600 text-white text-xs font-bold flex items-center justify-center">{v.label}</span>
                    <input value={v.subject} onChange={(e) => { const n = [...variants]; n[i] = { ...v, subject: e.target.value }; setVariants(n); }}
                      placeholder="Subject line" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <textarea value={v.body} onChange={(e) => { const n = [...variants]; n[i] = { ...v, body: e.target.value }; setVariants(n); }}
                    rows={4} className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-mono" />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {brandWebsite
                ? `The starter copy links to ${websiteHost(brandWebsite)}; the sender's name is appended automatically. Replace the bracketed text with your own pitch.`
                : "The sender's name is appended automatically. Replace the bracketed text with your own pitch."}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-indigo-600" /><span className="text-sm font-semibold text-gray-700">Follow-up sequence</span>
              <span className="text-xs text-gray-400">optional · auto-sent only if they don't reply</span></div>
            <FollowupEditor value={followups} onChange={setFollowups} />
            <label className="flex items-center gap-3 mt-3 cursor-pointer select-none">
              <button type="button" onClick={() => setEngaged(!engaged)} className={`relative h-6 w-11 rounded-full transition-colors flex-none ${engaged ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${engaged ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <span className="text-sm text-gray-600"><b className="text-gray-800">Only follow up with engaged contacts</b> — skip anyone who didn't open or click the previous email.</span>
            </label>
            <div className="mt-3">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Account manager <span className="text-xs font-normal text-gray-400">· for attribution</span></label>
              <input value={am} onChange={(e) => setAm(e.target.value)} placeholder="who runs this campaign"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white font-medium disabled:opacity-50">
            {saving ? 'Creating…' : 'Create & Activate'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailModal({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [fu, setFu] = useState<Followup[]>([]);
  const [eng, setEng] = useState(false);
  const [am, setAm] = useState('');
  const [savingFu, setSavingFu] = useState(false);
  const [savedFu, setSavedFu] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/campaigns/detail/${id}`, { cache: 'no-store' }).then((r) => r.json())
      .then((d) => { setData(d); setFu(d?.campaign?.followups || []); setEng(!!d?.campaign?.followup_engaged_only); setAm(d?.campaign?.account_manager || ''); }).catch(() => {});
  }, [id]);

  const saveFu = async () => {
    setSavingFu(true); setSavedFu(false);
    try {
      await fetch(`${API_BASE}/api/campaigns/${id}/update-followups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followups: fu, followup_engaged_only: eng, account_manager: am.trim() || null }),
      });
      setSavedFu(true); setTimeout(() => setSavedFu(false), 2500);
    } catch { /* ignore */ }
    setSavingFu(false);
  };

  const vs = data?.variants_stats || [];
  const bestOpen = Math.max(0, ...vs.map((v: any) => v.open_rate));

  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl my-4"
        initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fuchsia-600 to-purple-600 flex items-center justify-center"><Megaphone className="h-5 w-5 text-white" /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 truncate">{data?.campaign?.name || 'Campaign'}</h3>
              <p className="text-xs text-gray-500">{data?.campaign?.segment} · target {data?.campaign?.target_count}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>
        {!data ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
        ) : (
          <div className="p-5 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Big label="Sent" val={data.stats.sent} icon={<Mail className="h-4 w-4" />} />
              <Big label="Opened" val={`${data.stats.open_rate}%`} icon={<Eye className="h-4 w-4" />} />
              <Big label="Clicked" val={`${data.stats.click_rate}%`} icon={<MousePointerClick className="h-4 w-4" />} />
              <Big label="Replied" val={`${data.stats.reply_rate}%`} icon={<MessageCircle className="h-4 w-4" />} />
              <Big label="Target" val={data.campaign.target_count} icon={<Target className="h-4 w-4" />} />
            </div>

            {/* Follow-up control — edit the live sequence + engagement gate */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Clock className="h-4 w-4 text-indigo-600" /> Follow-up sequence</div>
                <button onClick={saveFu} disabled={savingFu || !canEdit} title={canEdit ? undefined : 'You do not have permission to edit campaigns'}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 min-w-[112px]">
                  {savingFu ? 'Saving…' : savedFu ? 'Saved ✓' : 'Save changes'}
                </button>
              </div>
              <label className="flex items-center gap-3 mt-3 cursor-pointer select-none">
                <button type="button" onClick={() => setEng(!eng)} className={`relative h-6 w-11 rounded-full transition-colors flex-none ${eng ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${eng ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <span className="text-sm text-gray-700"><b>Only follow up with engaged contacts</b> — skip anyone who didn't open or click the prior email.</span>
              </label>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">Account manager</span>
                <input value={am} onChange={(e) => setAm(e.target.value)} placeholder="who runs this campaign"
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              {fu.length > 0 && (
                <div className="flex items-center gap-1 mt-4 text-xs overflow-x-auto pb-1">
                  <span className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 font-semibold whitespace-nowrap">Intro</span>
                  {fu.map((f, i) => (
                    <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                      <span className="text-gray-300">→</span>
                      <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 font-semibold">F{i + 1} · +{f.after_days}d</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3"><FollowupEditor value={fu} onChange={setFu} /></div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"><Trophy className="h-4 w-4 text-fuchsia-600" /> A/B Variants</div>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500"><tr>
                    <th className="text-left px-4 py-2">Variant</th><th className="text-right px-4 py-2">Sent</th>
                    <th className="text-right px-4 py-2">Open %</th><th className="text-right px-4 py-2">Click %</th><th className="text-right px-4 py-2">Reply %</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {vs.map((v: any) => (
                      <tr key={v.variant} className={v.open_rate === bestOpen && bestOpen > 0 ? 'bg-emerald-50/60' : ''}>
                        <td className="px-4 py-2 font-semibold text-gray-900 flex items-center gap-2">
                          {v.variant}{v.open_rate === bestOpen && bestOpen > 0 && <Trophy className="h-3.5 w-3.5 text-emerald-600" />}
                        </td>
                        <td className="px-4 py-2 text-right">{v.sent}</td>
                        <td className="px-4 py-2 text-right font-medium text-amber-600">{v.open_rate}%</td>
                        <td className="px-4 py-2 text-right text-blue-600">{v.click_rate}%</td>
                        <td className="px-4 py-2 text-right text-emerald-600">{v.reply_rate}%</td>
                      </tr>
                    ))}
                    {vs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No sends yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"><Users className="h-4 w-4" /> By persona</div>
              <div className="flex flex-wrap gap-2">
                {(data.personas || []).map((p: any) => (
                  <div key={p.from_email} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm">
                    <span className="font-medium text-gray-900">{(s => s.charAt(0).toUpperCase() + s.slice(1))(p.from_email.split('@')[0])}</span>
                    <span className="text-gray-400"> · {p.sent} sent · {p.open_rate}% open</span>
                  </div>
                ))}
                {(!data.personas || data.personas.length === 0) && <span className="text-sm text-gray-400">No sends yet</span>}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"><TrendingUp className="h-4 w-4" /> Recent sends</div>
              <div className="overflow-x-auto rounded-xl border border-gray-200 max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr>
                    <th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">Recipient</th><th className="text-left px-4 py-2">From</th>
                    <th className="text-left px-4 py-2">Var</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(data.recent || []).map((e: any, i: number) => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2"><div className="font-medium text-gray-900">{e.recipient_name || '—'}</div><div className="text-xs text-gray-400">{e.recipient_email}</div></td>
                        <td className="px-4 py-2 text-gray-600">{(s => s.charAt(0).toUpperCase() + s.slice(1))((e.from_email || '').split('@')[0])}</td>
                        <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700 text-xs font-semibold">{e.variant || '—'}</span></td>
                        <td className="px-4 py-2">{e.replied_at ? '💬 Replied' : e.clicked_at ? '🖱 Clicked' : e.opened_at ? '👁 Opened' : 'Sent'}</td>
                        <td className="px-4 py-2 text-right"><button onClick={() => setEmailId(e.id)} className="text-purple-600 text-xs font-medium">Details</button></td>
                      </tr>
                    ))}
                    {(!data.recent || data.recent.length === 0) && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No sends yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </motion.div>
      <EmailDetailModal emailId={emailId} onClose={() => setEmailId(null)} />
    </motion.div>
  );
}

function Big({ label, val, icon }: { label: string; val: any; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs">{icon}{label}</div>
      <p className="text-xl font-bold text-gray-900 mt-1">{val}</p>
    </div>
  );
}
