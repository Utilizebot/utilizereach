import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2, Sparkles, Copy, Check, Trash2, Loader,
  BookOpen, Send, Clock, Linkedin, Facebook, Instagram,
  RefreshCw, ChevronDown, Link2, Link2Off, Settings, ExternalLink,
  CheckCircle2, XCircle
} from 'lucide-react';

// TikTok SVG icon (not in lucide-react)
function TikTokIcon({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || 'currentColor'} xmlns="http://www.w3.org/2000/svg">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.96a8.25 8.25 0 0 0 4.83 1.55V7.07a4.85 4.85 0 0 1-1.06-.38z"/>
    </svg>
  );
}
// Wrapper so TikTokIcon accepts the same { size, style } props as lucide icons
const TikTokPlatformIcon = ({ size, style }: { size?: number; style?: React.CSSProperties }) => (
  <TikTokIcon size={size} color={style?.color as string | undefined} />
);
import Swal from 'sweetalert2';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Post {
  id: string;
  platform: string;
  content: string;
  topic: string | null;
  tone: string | null;
  post_type: string | null;
  status: 'draft' | 'ready' | 'posted';
  created_at: string;
}

interface SocialAccount {
  platform: string;
  is_connected: boolean;
  handle: string | null;
  updated_at: string;
}

const PLATFORMS = [
  { id: 'linkedin',  label: 'LinkedIn',  Icon: Linkedin,           color: '#0A66C2', bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700'   },
  { id: 'tiktok',   label: 'TikTok',    Icon: TikTokPlatformIcon, color: '#010101', bg: 'bg-gray-50',   border: 'border-gray-300',   text: 'text-gray-800'   },
  { id: 'facebook',  label: 'Facebook',  Icon: Facebook,           color: '#1877F2', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700' },
  { id: 'instagram', label: 'Instagram', Icon: Instagram,          color: '#E1306C', bg: 'bg-pink-50',   border: 'border-pink-200',   text: 'text-pink-700'   },
];

// Fields required per platform to connect
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; placeholder: string; hint?: string }[]> = {
  linkedin: [
    { key: 'access_token', label: 'Access Token',  placeholder: 'AQV…',        hint: 'From LinkedIn Developer Portal → OAuth 2.0 token' },
    { key: 'person_urn',   label: 'Person URN',    placeholder: 'urn:li:person:XXXXXXX', hint: 'Your LinkedIn member URN' },
  ],
  tiktok: [
    { key: 'access_token', label: 'Access Token', placeholder: 'att_…', hint: 'OAuth 2.0 access token from TikTok for Developers' },
    { key: 'open_id',      label: 'Open ID',      placeholder: '_000abc…',    hint: "Your TikTok account's Open ID (returned during OAuth)" },
  ],
  facebook: [
    { key: 'page_access_token', label: 'Page Access Token', placeholder: 'EAA…', hint: 'Long-lived Page Token from Meta Developer Portal' },
    { key: 'page_id',           label: 'Page ID',            placeholder: '123456789' },
  ],
  instagram: [
    { key: 'access_token',   label: 'Access Token',          placeholder: 'EAA…', hint: 'Facebook Page Access Token (same app)' },
    { key: 'ig_account_id',  label: 'Instagram Account ID',  placeholder: '17841…' },
  ],
};

const TONES = [
  { id: 'professional',  label: 'Professional'  },
  { id: 'casual',        label: 'Casual'        },
  { id: 'inspirational', label: 'Inspirational' },
  { id: 'educational',   label: 'Educational'   },
  { id: 'promotional',   label: 'Promotional'   },
  { id: 'storytelling',  label: 'Storytelling'  },
];

const POST_TYPES = [
  { id: 'post',   label: 'Single Post' },
  { id: 'thread', label: 'Thread'      },
  { id: 'story',  label: 'Story / Slides' },
];

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft:  { label: 'Draft',  bg: 'bg-gray-100',    text: 'text-gray-600'   },
  ready:  { label: 'Ready',  bg: 'bg-amber-100',   text: 'text-amber-700'  },
  posted: { label: 'Posted', bg: 'bg-emerald-100', text: 'text-emerald-700'},
};

function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SocialMedia() {
  const [activePlatform, setActivePlatform] = useState('linkedin');
  const [topic, setTopic]       = useState('');
  const [tone, setTone]         = useState('professional');
  const [postType, setPostType] = useState('post');
  const [generated, setGenerated] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [saving, setSaving]     = useState(false);

  const [posts, setPosts]       = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterStatus, setFilterStatus]   = useState('');

  // Social accounts state
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [connectPlatform, setConnectPlatform] = useState<string | null>(null);
  const [credInputs, setCredInputs] = useState<Record<string, string>>({});
  const [handleInput, setHandleInput] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [testingAccount, setTestingAccount] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  useEffect(() => { loadPosts(); loadAccounts(); }, [filterPlatform, filterStatus]);

  const loadPosts = async () => {
    setLoadingPosts(true);
    try {
      const params = new URLSearchParams();
      if (filterPlatform) params.set('platform', filterPlatform);
      if (filterStatus)   params.set('status', filterStatus);
      const res = await fetch(`${API_BASE}/api/social-media/posts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPosts(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/social-accounts/`);
      if (res.ok) { const d = await res.json(); setAccounts(d.accounts || []); }
    } catch (e) { console.error(e); }
  };

  const openConnect = (platform: string) => {
    setConnectPlatform(platform);
    setCredInputs({});
    setHandleInput('');
  };

  const handleSaveAccount = async () => {
    if (!connectPlatform) return;
    setSavingAccount(true);
    try {
      const res = await fetch(`${API_BASE}/api/social-accounts/${connectPlatform}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: credInputs, handle: handleInput || null }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Save failed'); }
      await loadAccounts();
      setConnectPlatform(null);
      Swal.fire({ icon: 'success', title: 'Account connected!', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Failed', text: err instanceof Error ? err.message : '', confirmButtonColor: '#dc2626' });
    } finally { setSavingAccount(false); }
  };

  const handleDisconnect = async (platform: string) => {
    const r = await Swal.fire({ title: `Disconnect ${platform}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Disconnect' });
    if (!r.isConfirmed) return;
    await fetch(`${API_BASE}/api/social-accounts/${platform}/disconnect`, { method: 'DELETE' });
    await loadAccounts();
  };

  const handleTestConnection = async (platform: string) => {
    setTestingAccount(true);
    try {
      const res = await fetch(`${API_BASE}/api/social-accounts/${platform}/test`, { method: 'POST' });
      const d = await res.json();
      if (res.ok) Swal.fire({ icon: 'success', title: `Connected as ${d.name || platform}`, timer: 2000, showConfirmButton: false });
      else Swal.fire({ icon: 'error', title: 'Connection failed', text: d.detail, confirmButtonColor: '#dc2626' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Test failed', text: err instanceof Error ? err.message : '', confirmButtonColor: '#dc2626' });
    } finally { setTestingAccount(false); }
  };

  const handlePostNow = async (post: Post) => {
    const acct = accounts.find(a => a.platform === post.platform);
    if (!acct?.is_connected) {
      Swal.fire({ icon: 'warning', title: `${post.platform} not connected`, text: 'Connect your account below first.', confirmButtonColor: '#7c3aed' });
      return;
    }
    const r = await Swal.fire({ title: `Post to ${post.platform}?`, icon: 'question', showCancelButton: true, confirmButtonColor: '#7c3aed', confirmButtonText: 'Post Now' });
    if (!r.isConfirmed) return;
    setPostingId(post.id);
    try {
      const res = await fetch(`${API_BASE}/api/social-accounts/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: post.platform, content: post.content, post_id: post.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Post failed');
      await loadPosts();
      Swal.fire({ icon: 'success', title: 'Posted!', html: d.url ? `<a href="${d.url}" target="_blank" class="text-blue-600 underline">View post ↗</a>` : '', timer: d.url ? undefined : 2000, showConfirmButton: !!d.url });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Posting failed', text: err instanceof Error ? err.message : '', confirmButtonColor: '#dc2626' });
    } finally { setPostingId(null); }
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      Swal.fire({ icon: 'warning', title: 'Topic required', text: 'Please enter a topic or idea for the post.', confirmButtonColor: '#7c3aed' });
      return;
    }
    setGenerating(true);
    setGenerated('');
    try {
      const res = await fetch(`${API_BASE}/api/social-media/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activePlatform, topic, tone, post_type: postType }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || 'Generation failed');
      }
      const data = await res.json();
      setGenerated(data.content);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Generation failed', text: err instanceof Error ? err.message : 'Something went wrong', confirmButtonColor: '#dc2626' });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (status: 'draft' | 'ready') => {
    if (!generated.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/social-media/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activePlatform, content: generated, topic, tone, post_type: postType, status }),
      });
      if (!res.ok) throw new Error('Save failed');
      await loadPosts();
      Swal.fire({ icon: 'success', title: status === 'ready' ? 'Marked as Ready!' : 'Saved as Draft', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Save failed', text: err instanceof Error ? err.message : '', confirmButtonColor: '#dc2626' });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (post: Post, newStatus: Post['status']) => {
    try {
      await fetch(`${API_BASE}/api/social-media/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await loadPosts();
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (post: Post) => {
    const r = await Swal.fire({
      title: 'Delete this post?', icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#dc2626', cancelButtonColor: '#6b7280', confirmButtonText: 'Delete',
    });
    if (!r.isConfirmed) return;
    await fetch(`${API_BASE}/api/social-media/posts/${post.id}`, { method: 'DELETE' });
    await loadPosts();
  };

  const handleCopyPost = async (content: string) => {
    await navigator.clipboard.writeText(content);
    Swal.fire({ icon: 'success', title: 'Copied!', timer: 1000, showConfirmButton: false });
  };

  const charLimit: Record<string, number> = { linkedin: 3000, tiktok: 2200, facebook: 2000, instagram: 2200 };
  const limit = charLimit[activePlatform] || 3000;
  const charCount = generated.length;
  const overLimit = charCount > limit;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <motion.div className="flex items-center gap-4" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="h-12 w-12 bg-gradient-to-br from-pink-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg">
          <Share2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Social Media Agent</h1>
          <p className="text-gray-500 text-sm mt-0.5">AI-powered content creation for every platform</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── LEFT: Generator ── */}
        <motion.div
          className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        >
          {/* Platform tabs */}
          <div className="flex border-b border-gray-100">
            {PLATFORMS.map(p => {
              const active = activePlatform === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActivePlatform(p.id)}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-semibold transition-colors border-b-2 ${
                    active ? 'border-b-2 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                  style={active ? { borderColor: p.color } : {}}
                >
                  <p.Icon size={18} style={{ color: active ? p.color : undefined }} />
                  <span className="hidden sm:block">{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-5 flex flex-col gap-4 flex-1">

            {/* Topic */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Topic / Idea</label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                rows={3}
                placeholder="e.g. Our AI platform helped a client close 3× more deals in Q3…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-400 focus:border-transparent resize-none"
              />
            </div>

            {/* Tone + Post type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Tone</label>
                <div className="relative">
                  <select
                    value={tone}
                    onChange={e => setTone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-violet-400 focus:border-transparent pr-8"
                  >
                    {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Format</label>
                <div className="relative">
                  <select
                    value={postType}
                    onChange={e => setPostType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-violet-400 focus:border-transparent pr-8"
                  >
                    {POST_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-60"
            >
              {generating ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generating ? 'Generating…' : 'Generate Content'}
            </button>

            {/* Generated content */}
            <AnimatePresence>
              {(generated || generating) && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Generated Content</label>
                    {generated && (
                      <span className={`text-xs font-medium ${overLimit ? 'text-red-600' : 'text-gray-400'}`}>
                        {charCount} / {limit}
                      </span>
                    )}
                  </div>

                  {generating ? (
                    <div className="bg-gray-50 rounded-xl p-4 min-h-[120px] flex items-center justify-center">
                      <Loader size={24} className="animate-spin text-violet-500" />
                    </div>
                  ) : (
                    <textarea
                      value={generated}
                      onChange={e => setGenerated(e.target.value)}
                      rows={8}
                      className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-violet-400 resize-none ${overLimit ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                    />
                  )}

                  {generated && !generating && (
                    <div className="flex gap-2">
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                      >
                        {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        onClick={() => handleSave('draft')}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        <BookOpen size={13} /> Save Draft
                      </button>
                      <button
                        onClick={() => handleSave('ready')}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
                      >
                        <Send size={13} /> Mark Ready
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {!generated && !generating && (
              <div className="flex-1 flex flex-col items-center justify-center py-10 text-gray-300">
                <Share2 size={40} className="mb-2 opacity-40" />
                <p className="text-sm font-medium text-gray-400">Enter a topic and generate content</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── RIGHT: Post Queue ── */}
        <motion.div
          className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        >
          {/* Queue header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/60">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Post Queue</span>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{posts.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Platform filter */}
              <select
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-violet-400"
              >
                <option value="">All platforms</option>
                {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-violet-400"
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
                <option value="posted">Posted</option>
              </select>
              <button onClick={loadPosts} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <RefreshCw size={13} className={`text-gray-400 ${loadingPosts ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50" style={{ maxHeight: '520px' }}>
            {loadingPosts ? (
              <div className="flex items-center justify-center py-16">
                <Loader size={24} className="animate-spin text-violet-400" />
              </div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                <Clock size={36} className="mb-2 opacity-40" />
                <p className="text-sm font-medium text-gray-400">No posts yet</p>
                <p className="text-xs text-gray-300 mt-0.5">Generate content and save drafts</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {posts.map(post => {
                  const pm = PLATFORMS.find(p => p.id === post.platform);
                  const sm = STATUS_META[post.status] || STATUS_META.draft;
                  const PIcon = pm?.Icon || Share2;
                  return (
                    <motion.div
                      key={post.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-5 py-4 hover:bg-gray-50/70 transition-colors"
                    >
                      {/* Post header */}
                      <div className="flex items-center gap-2 mb-2">
                        <PIcon size={14} style={{ color: pm?.color || '#6b7280' }} />
                        <span className="text-xs font-semibold text-gray-600">{pm?.label || post.platform}</span>
                        {post.tone && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded capitalize">{post.tone}</span>
                        )}
                        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${sm.bg} ${sm.text}`}>
                          {sm.label}
                        </span>
                        <span className="text-[10px] text-gray-400">{relTime(post.created_at)}</span>
                      </div>

                      {/* Content preview */}
                      <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">{post.content}</p>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                        <button
                          onClick={() => handleCopyPost(post.content)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                        >
                          <Copy size={10} /> Copy
                        </button>
                        {post.status !== 'posted' && (
                          <button
                            onClick={() => handlePostNow(post)}
                            disabled={postingId === post.id}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                          >
                            {postingId === post.id ? <Loader size={10} className="animate-spin" /> : <Send size={10} />}
                            Post Now
                          </button>
                        )}
                        {post.status !== 'ready' && post.status !== 'posted' && (
                          <button
                            onClick={() => handleStatusChange(post, 'ready')}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                          >
                            Mark Ready
                          </button>
                        )}
                        {post.status !== 'posted' && (
                          <button
                            onClick={() => handleStatusChange(post, 'posted')}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                          >
                            <Check size={10} /> Mark Posted
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(post)}
                          className="ml-auto p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Connected Accounts ── */}
      <motion.div
        className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
          <Settings size={15} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Connected Accounts</span>
          <span className="text-xs text-gray-400 ml-1">— enter your API credentials to enable direct posting</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {PLATFORMS.map(p => {
            const acct = accounts.find(a => a.platform === p.id);
            const connected = acct?.is_connected ?? false;
            return (
              <div key={p.id} className="p-5 flex flex-col gap-3">
                {/* Platform header */}
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${p.color}18` }}>
                    <p.Icon size={18} style={{ color: p.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{p.label}</p>
                    <p className="text-[10px] text-gray-400 truncate">{acct?.handle || 'Not connected'}</p>
                  </div>
                  {connected
                    ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                    : <XCircle      size={16} className="text-gray-300 flex-shrink-0" />}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5">
                  {connected ? (
                    <>
                      <button
                        onClick={() => handleTestConnection(p.id)}
                        disabled={testingAccount}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {testingAccount ? <Loader size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                        Test Connection
                      </button>
                      <button
                        onClick={() => openConnect(p.id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                      >
                        <Settings size={11} /> Update Credentials
                      </button>
                      <button
                        onClick={() => handleDisconnect(p.id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-colors"
                      >
                        <Link2Off size={11} /> Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openConnect(p.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                      style={{ backgroundColor: p.color }}
                    >
                      <Link2 size={11} /> Connect {p.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── Connect / Credentials Modal ── */}
      <AnimatePresence>
        {connectPlatform && (() => {
          const pm = PLATFORMS.find(p => p.id === connectPlatform)!;
          const fields = CREDENTIAL_FIELDS[connectPlatform] || [];
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget) setConnectPlatform(null); }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              >
                {/* Modal header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100" style={{ backgroundColor: `${pm.color}10` }}>
                  <pm.Icon size={20} style={{ color: pm.color }} />
                  <p className="font-bold text-gray-900">Connect {pm.label}</p>
                </div>

                <div className="p-5 space-y-4">
                  {/* Handle */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Display Handle / Username</label>
                    <input
                      value={handleInput}
                      onChange={e => setHandleInput(e.target.value)}
                      placeholder={`@your${connectPlatform}handle`}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                    />
                  </div>

                  {/* Credential fields */}
                  {fields.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">{f.label}</label>
                      <input
                        value={credInputs[f.key] || ''}
                        onChange={e => setCredInputs(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                      />
                      {f.hint && <p className="text-[10px] text-gray-400 mt-0.5">{f.hint}</p>}
                    </div>
                  ))}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setConnectPlatform(null)}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveAccount}
                      disabled={savingAccount}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: pm.color }}
                    >
                      {savingAccount ? <Loader size={14} className="animate-spin" /> : <Link2 size={14} />}
                      Save & Connect
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

    </div>
  );
}
