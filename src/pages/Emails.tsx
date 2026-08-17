import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Mail,
  Send,
  Eye,
  MousePointerClick,
  MessageCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Filter,
  Download,
  RefreshCw,
  Clock,
  XCircle,
  Users,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  Loader2,
  User,
  AtSign,
  Lightbulb,
  Edit3,
  BarChart2,
  ArrowRight,
  Send as SendIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { EmailDetailModal } from '../components/EmailDetailModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface EmailStats {
  sent_today: number;
  total_sent: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
  bounced_count: number;
  rejected_count: number;
  failed_total: number;
  delivered_count: number;
  unsubscribe_count: number;
  ai_cost_per_email: number;
  total_cost: number;
  date_range: { from: string; to: string };
}

interface SentEmail {
  id: string;
  recipient_email: string;
  recipient_name: string;
  subject: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at?: string | null;
  replied_at?: string | null;
  bounced_at?: string | null;
  status: string;
  campaign_id: string | null;
  opens: number;
  clicks: number;
}

interface PerformancePoint {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
}

interface PreviewData {
  subject: string;
  body_html: string;
  body_text: string;
  preview: string;
}

interface TestEmailResult {
  success: boolean;
  message: string;
  subject?: string;
  preview?: string;
  gmail_message_id?: string;
}

export function Emails() {
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [performance, setPerformance] = useState<PerformancePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Test email state
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testName, setTestName] = useState('');
  const [testHints, setTestHints] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testPreviewing, setTestPreviewing] = useState(false);
  const [testResult, setTestResult] = useState<TestEmailResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Email detail modal
  const [detailId, setDetailId] = useState<string | null>(null);

  // Search + status + period filters + pagination
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'opened' | 'clicked' | 'replied' | 'bounced'>('all');
  const [period, setPeriod] = useState<'all' | 'today' | '7d' | '30d' | 'month' | 'custom'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const fmtDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const applyPreset = (p: typeof period) => {
    const now = new Date();
    const today = fmtDay(now);
    if (p === 'all') { setFromDate(''); setToDate(''); }
    else if (p === 'today') { setFromDate(today); setToDate(today); }
    else if (p === '7d') { const s = new Date(now); s.setDate(s.getDate() - 6); setFromDate(fmtDay(s)); setToDate(today); }
    else if (p === '30d') { const s = new Date(now); s.setDate(s.getDate() - 29); setFromDate(fmtDay(s)); setToDate(today); }
    else if (p === 'month') { setFromDate(fmtDay(new Date(now.getFullYear(), now.getMonth(), 1))); setToDate(today); }
    setPeriod(p);
    setCurrentPage(1);
  };

  const engagementOf = (e: SentEmail) => {
    // A bounced (undelivered) email can't be genuinely opened/clicked — any
    // "open" on it is an automated scanner/image-proxy prefetching the pixel.
    // So a bounce is exclusive: it counts only as bounced.
    const bounced = !!e.bounced_at || e.status === 'bounced';
    return {
      bounced,
      opened: !bounced && (!!e.opened_at || (e.opens || 0) > 0),
      clicked: !bounced && (!!e.clicked_at || (e.clicks || 0) > 0),
      replied: !bounced && (!!e.replied_at || e.status === 'replied'),
    };
  };

  // period (date range) filter
  const start = fromDate ? new Date(fromDate + 'T00:00:00') : null;
  const end = toDate ? new Date(toDate + 'T23:59:59.999') : null;
  const periodEmails = start || end
    ? emails.filter((e) => { const t = new Date(e.sent_at); return (!start || t >= start) && (!end || t <= end); })
    : emails;

  // counts across the period-filtered set (drive the clickable cards)
  const counts = { all: periodEmails.length, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  for (const e of periodEmails) {
    const g = engagementOf(e);
    if (g.opened) counts.opened++;
    if (g.clicked) counts.clicked++;
    if (g.replied) counts.replied++;
    if (g.bounced) counts.bounced++;
  }
  const pctOf = (n: number) => (counts.all ? Math.round((n / counts.all) * 100) : 0);

  const q = search.trim().toLowerCase();
  const byFilter = filter === 'all' ? periodEmails : periodEmails.filter((e) => engagementOf(e)[filter]);
  const filteredEmails = q
    ? byFilter.filter((e) =>
        (e.recipient_email || '').toLowerCase().includes(q) ||
        (e.recipient_name || '').toLowerCase().includes(q) ||
        (e.subject || '').toLowerCase().includes(q))
    : byFilter;
  const totalPages = Math.max(1, Math.ceil(filteredEmails.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const paginatedEmails = filteredEmails.slice(pageStart, pageStart + pageSize);

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const [statsRes, emailsRes, perfRes] = await Promise.all([
        fetch(`${API_BASE}/api/emails/stats`),
        fetch(`${API_BASE}/api/emails/sent?limit=5000`),
        fetch(`${API_BASE}/api/emails/performance`),
      ]);

      if (!statsRes.ok || !emailsRes.ok) throw new Error('Failed to fetch email data');

      const statsData = await statsRes.json();
      const emailsData = await emailsRes.json();
      setStats(statsData);
      setEmails(emailsData.emails || []);

      if (perfRes.ok) {
        const perfData = await perfRes.json();
        setPerformance(perfData.data || []);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const generatePreview = async () => {
    if (!testTo.trim()) return;
    setTestPreviewing(true);
    setPreview(null);
    setTestError(null);
    setTestResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/test-email/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: testTo.trim(),
          to_name: testName.trim(),
          hints: testHints.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestError(data.detail || 'Failed to generate preview');
      } else {
        setPreview(data);
        setEditSubject(data.subject || '');
        setEditBody(data.body_text || '');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTestPreviewing(false);
    }
  };

  const sendTestEmail = async () => {
    if (!testTo.trim()) return;
    setTestSending(true);
    setTestResult(null);
    setTestError(null);

    try {
      const body: Record<string, string> = {
        to_email: testTo.trim(),
        to_name: testName.trim(),
        hints: testHints.trim(),
      };

      // If we have a preview, send the (possibly edited) content
      if (preview) {
        body.subject = editSubject;
        body.body_html = preview.body_html;
        body.body_text = editBody;
      }

      const res = await fetch(`${API_BASE}/api/test-email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestError(data.detail || 'Failed to send test email');
      } else {
        setTestResult(data);
        setPreview(null);
        setTimeout(() => fetchData(), 2000);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTestSending(false);
    }
  };

  const resetTestPanel = () => {
    setTestTo('');
    setTestName('');
    setTestHints('');
    setPreview(null);
    setTestResult(null);
    setTestError(null);
    setEditSubject('');
    setEditBody('');
  };

  const safePercentage = (value: number): number => {
    if (!value || isNaN(value)) return 0;
    return Math.round(value);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatChartDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="inline-block h-16 w-16 border-4 border-emerald-600 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="mt-4 text-gray-600 font-medium">Loading email analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Failed to Load</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={fetchData}
            className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Period-aware KPI values, derived from the bounce-exclusive `counts` object
  const delivered = counts.all - counts.bounced;
  const openRate = pctOf(counts.opened);
  const clickRate = pctOf(counts.clicked);
  const replyRate = pctOf(counts.replied);
  const bounceRate = pctOf(counts.bounced);

  // Engagement funnel data (period-aware)
  const funnelData = [
    { label: 'Sent', value: counts.all, color: 'from-blue-500 to-blue-600', pct: 100 },
    { label: 'Opened', value: counts.opened, color: 'from-amber-500 to-amber-600', pct: openRate },
    { label: 'Clicked', value: counts.clicked, color: 'from-emerald-500 to-emerald-600', pct: clickRate },
    { label: 'Replied', value: counts.replied, color: 'from-purple-500 to-purple-600', pct: replyRate },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
              <Mail className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Email Campaign Analytics
              </h1>
              <p className="text-gray-600 text-sm mt-0.5">
                Monitor email performance, engagement, and ROI in real-time
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowTestEmail(!showTestEmail); setTestResult(null); setTestError(null); if (showTestEmail) resetTestPanel(); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all shadow-sm ${
                showTestEmail
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span>AI Test Email</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTestEmail ? 'rotate-180' : ''}`} />
            </button>

            <button
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="font-medium text-sm">Refresh</span>
            </button>

            <button className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:shadow-lg transition-all">
              <Download className="h-4 w-4" />
              <span className="font-medium text-sm">Export</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* AI Test Email Panel */}
      <AnimatePresence>
        {showTestEmail && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="bg-white rounded-2xl shadow-lg border border-blue-200 overflow-hidden">
              {/* Panel header */}
              <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">AI-Powered Test Email</h3>
                    <p className="text-blue-200 text-sm">Give the AI some hints → preview the generated email → send</p>
                  </div>
                  {/* Step indicator */}
                  <div className="ml-auto flex items-center gap-2 text-blue-200 text-sm">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${!preview && !testResult ? 'bg-white/25 text-white' : 'bg-white/10'}`}>1. Compose</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${preview && !testResult ? 'bg-white/25 text-white' : 'bg-white/10'}`}>2. Preview</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${testResult ? 'bg-white/25 text-white' : 'bg-white/10'}`}>3. Sent</span>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {/* Step 1: Compose — show only when no preview yet */}
                {!preview && !testResult && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                          <AtSign className="h-4 w-4 text-blue-500" />
                          Recipient Email <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          value={testTo}
                          onChange={(e) => setTestTo(e.target.value)}
                          placeholder="recipient@example.com"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 focus:bg-white transition-all"
                          disabled={testPreviewing}
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                          <User className="h-4 w-4 text-blue-500" />
                          Recipient Name <span className="text-gray-400 font-normal">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={testName}
                          onChange={(e) => setTestName(e.target.value)}
                          placeholder="John Doe"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 focus:bg-white transition-all"
                          disabled={testPreviewing}
                        />
                      </div>
                    </div>

                    <div className="mb-5">
                      <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                        <Lightbulb className="h-4 w-4 text-amber-500" />
                        AI Hints <span className="text-gray-400 font-normal">(tell the AI what to focus on)</span>
                      </label>
                      <textarea
                        value={testHints}
                        onChange={(e) => setTestHints(e.target.value)}
                        placeholder={`e.g.\n- Mention our new Q4 pricing offer\n- This person is a CFO at a mid-size bank\n- Highlight cost-savings and compliance benefits`}
                        rows={4}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:bg-white transition-all resize-none font-mono"
                        disabled={testPreviewing}
                      />
                      <p className="text-xs text-gray-400 mt-1.5">Each bullet point becomes a directive to the AI. The more specific, the better the result.</p>
                    </div>

                    <button
                      onClick={generatePreview}
                      disabled={!testTo.trim() || testPreviewing}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all ${
                        !testTo.trim() || testPreviewing
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-lg hover:-translate-y-0.5 shadow-md'
                      }`}
                    >
                      {testPreviewing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />AI is writing your email...</>
                      ) : (
                        <><Sparkles className="h-4 w-4" />Generate Preview</>
                      )}
                    </button>
                    {testPreviewing && (
                      <p className="text-sm text-gray-500 animate-pulse mt-3">
                        The AI is crafting a personalized email based on your hints...
                      </p>
                    )}
                  </>
                )}

                {/* Step 2: Preview & Edit */}
                <AnimatePresence>
                  {preview && !testResult && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2">
                          <Edit3 className="h-4 w-4 text-blue-500" />
                          Review & Edit Before Sending
                        </h4>
                        <button
                          onClick={() => { setPreview(null); setTestError(null); }}
                          className="text-sm text-gray-500 hover:text-gray-700 underline"
                        >
                          ← Start over
                        </button>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-4">
                        <label className="block text-xs font-bold text-blue-700 uppercase tracking-wider mb-1.5">Subject Line</label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-lg text-sm font-medium text-gray-900 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all"
                        />
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-5">
                        <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Email Body</label>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={8}
                          className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all resize-none leading-relaxed"
                        />
                        <p className="text-xs text-gray-400 mt-1.5">You can edit the subject and body. Sending uses the HTML version from the preview above.</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={sendTestEmail}
                          disabled={testSending || !editSubject.trim()}
                          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all ${
                            testSending || !editSubject.trim()
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:-translate-y-0.5 shadow-md'
                          }`}
                        >
                          {testSending ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Sending...</>
                          ) : (
                            <><SendIcon className="h-4 w-4" />Send This Email</>
                          )}
                        </button>
                        <button
                          onClick={generatePreview}
                          disabled={testPreviewing || testSending}
                          className="flex items-center gap-2 px-4 py-3 rounded-xl font-medium text-sm bg-white border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700"
                        >
                          <RefreshCw className={`h-4 w-4 ${testPreviewing ? 'animate-spin' : ''}`} />
                          Regenerate
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Step 3: Success */}
                <AnimatePresence>
                  {testResult && testResult.success && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="bg-emerald-50 border border-emerald-200 rounded-xl p-5"
                    >
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-emerald-800">{testResult.message}</p>
                          {testResult.subject && (
                            <p className="text-sm text-emerald-700 mt-2"><span className="font-medium">Subject:</span> {testResult.subject}</p>
                          )}
                          {testResult.preview && (
                            <p className="text-sm text-emerald-600 mt-1 line-clamp-3"><span className="font-medium">Preview:</span> {testResult.preview}</p>
                          )}
                          {testResult.gmail_message_id && (
                            <p className="text-xs text-emerald-500 mt-2 font-mono">Message ID: {testResult.gmail_message_id}</p>
                          )}
                        </div>
                        <button
                          onClick={resetTestPanel}
                          className="text-sm text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap"
                        >
                          Send another
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error */}
                <AnimatePresence>
                  {testError && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 bg-red-50 border border-red-200 rounded-xl p-5"
                    >
                      <div className="flex items-start gap-3">
                        <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-red-800">Something went wrong</p>
                          <p className="text-sm text-red-600 mt-1">{testError}</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page-level Period filter bar — governs every metric on this page */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1 flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Period
          </span>
          {([
            { key: 'all', label: 'All time' },
            { key: 'today', label: 'Today' },
            { key: '7d', label: 'Last 7 days' },
            { key: '30d', label: 'Last 30 days' },
            { key: 'month', label: 'This month' },
          ] as const).map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                period === p.key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs text-gray-500">From</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => { setFromDate(e.target.value); setPeriod('custom'); setCurrentPage(1); }}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
            <span className="text-xs text-gray-500">To</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => { setToDate(e.target.value); setPeriod('custom'); setCurrentPage(1); }}
              className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
          <span className="text-xs text-gray-400 ml-auto">
            {counts.all.toLocaleString()} email{counts.all === 1 ? '' : 's'} in range
          </span>
        </div>
      </motion.div>

      {/* Period-aware KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-6">
        <StatCard title="Total Sent" value={counts.all} subtitle={`Sent today: ${stats.sent_today}`} icon={Mail} gradient="from-purple-500 to-purple-600" delay={0} />
        <StatCard title="Delivered" value={delivered} subtitle={`${bounceRate}% bounced`} icon={Send} gradient="from-blue-500 to-blue-600" delay={0.05} />
        <StatCard title="Open Rate" value={`${openRate}%`} subtitle={openRate >= 25 ? 'Above average' : 'Below average'} icon={Eye} gradient="from-amber-500 to-amber-600" delay={0.1} trend={openRate >= 25 ? 'up' : 'down'} />
        <StatCard title="Click Rate" value={`${clickRate}%`} subtitle={`${counts.clicked} clicked`} icon={MousePointerClick} gradient="from-cyan-500 to-blue-600" delay={0.15} />
        <StatCard title="Reply Rate" value={`${replyRate}%`} subtitle={replyRate >= 5 ? 'Excellent' : 'Good'} icon={MessageCircle} gradient="from-emerald-500 to-emerald-600" delay={0.2} trend={replyRate >= 5 ? 'up' : 'down'} />
        <StatCard title="Bounce Rate" value={`${bounceRate}%`} subtitle={`${counts.bounced} bounced`} icon={AlertTriangle} gradient="from-orange-500 to-red-600" delay={0.25} trend={bounceRate <= 2 ? 'up' : 'down'} />
      </div>

      {/* Deliverability callout — reconciles post-send bounces + pre-send rejects */}
      <motion.div
        className="bg-gradient-to-r from-slate-50 via-white to-slate-50 rounded-2xl shadow-lg border border-gray-200 p-5 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 pr-3">
            <div className="h-9 w-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md">
              <CheckCircle2 className="h-5 w-5 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-900">Deliverability</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-sm">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Send className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-gray-900">{counts.all.toLocaleString()}</p>
              <p className="text-[11px] font-medium text-gray-500">Sent</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-amber-200 shadow-sm">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-amber-700">{counts.bounced.toLocaleString()}</p>
              <p className="text-[11px] font-medium text-gray-500">Bounced <span className="text-gray-400">(post-send)</span></p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-orange-200 shadow-sm">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
              <XCircle className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-orange-700">{stats.rejected_count.toLocaleString()}</p>
              <p className="text-[11px] font-medium text-gray-500">Rejected before send</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-red-200 shadow-sm">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-red-700">{stats.failed_total.toLocaleString()}</p>
              <p className="text-[11px] font-medium text-gray-500">Undeliverable total</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-emerald-200 shadow-sm ml-auto">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-base font-bold text-emerald-700">${stats.total_cost.toFixed(2)}</p>
              <p className="text-[11px] font-medium text-gray-500">AI cost</p>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2.5">
          Undeliverable = post-send bounces + addresses rejected before sending (no mail server / invalid).
        </p>
      </motion.div>

      {/* Analytics: Chart + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Time-series performance chart */}
        <motion.div
          className="lg:col-span-2 bg-white rounded-2xl shadow-lg border border-gray-200 p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <BarChart2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Campaign Performance</h2>
              <p className="text-sm text-gray-500">Last 7 days — emails sent, opened & clicked</p>
            </div>
          </div>

          {performance.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No performance data yet. Send some emails to see trends here.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={performance} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorClicked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 12 }}
                  labelFormatter={(v) => formatChartDate(String(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                <Area type="monotone" dataKey="sent" name="Sent" stroke="#6366f1" strokeWidth={2} fill="url(#colorSent)" dot={false} />
                <Area type="monotone" dataKey="opened" name="Opened" stroke="#f59e0b" strokeWidth={2} fill="url(#colorOpened)" dot={false} />
                <Area type="monotone" dataKey="clicked" name="Clicked" stroke="#10b981" strokeWidth={2} fill="url(#colorClicked)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Engagement Funnel */}
        <motion.div
          className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Engagement Funnel</h2>
              <p className="text-sm text-gray-500">30-day conversion pipeline</p>
            </div>
          </div>

          <div className="space-y-3">
            {funnelData.map((step, i) => (
              <div key={step.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">{step.label}</span>
                  <span className="text-sm font-bold text-gray-900">{step.value.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full bg-gradient-to-r ${step.color} rounded-full`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(step.pct, 2)}%` }}
                    transition={{ delay: 0.5 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{safePercentage(step.pct)}% of sent</p>
              </div>
            ))}
          </div>

          {/* Additional metrics */}
          <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs font-medium text-orange-600 mb-0.5">Bounced</p>
              <p className="text-xl font-bold text-orange-700">{counts.bounced.toLocaleString()} <span className="text-sm font-semibold">· {bounceRate}%</span></p>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-xs font-medium text-green-600 mb-0.5">AI Cost</p>
              <p className="text-xl font-bold text-green-700">${stats.total_cost.toFixed(2)}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Sent Emails Table */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65 }}
      >
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl flex items-center justify-center">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Sent Emails</h2>
                <p className="text-sm text-gray-600">
                  {filteredEmails.length.toLocaleString()}{q ? ` of ${emails.length.toLocaleString()}` : ''} emails
                  {filteredEmails.length > 0 && ` — showing ${pageStart + 1}-${Math.min(pageStart + pageSize, filteredEmails.length)}`}
                </p>
              </div>
            </div>
            <div className="relative">
              <Filter className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Search recipient or subject…"
                className="pl-9 pr-3 py-2 w-64 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Clickable filter chips — drill down into the table below */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Filter</span>
            {[
              { key: 'all', label: 'All Sent', count: counts.all, pct: 100, Icon: Mail, grad: 'bg-gradient-to-r from-emerald-500 to-teal-600', text: 'text-emerald-600', chip: 'bg-emerald-50 border-emerald-100' },
              { key: 'opened', label: 'Opened', count: counts.opened, pct: pctOf(counts.opened), Icon: Eye, grad: 'bg-gradient-to-r from-amber-500 to-amber-600', text: 'text-amber-600', chip: 'bg-amber-50 border-amber-100' },
              { key: 'clicked', label: 'Clicked', count: counts.clicked, pct: pctOf(counts.clicked), Icon: MousePointerClick, grad: 'bg-gradient-to-r from-blue-500 to-blue-600', text: 'text-blue-600', chip: 'bg-blue-50 border-blue-100' },
              { key: 'replied', label: 'Replied', count: counts.replied, pct: pctOf(counts.replied), Icon: MessageCircle, grad: 'bg-gradient-to-r from-purple-500 to-purple-600', text: 'text-purple-600', chip: 'bg-purple-50 border-purple-100' },
              { key: 'bounced', label: 'Bounced', count: counts.bounced, pct: pctOf(counts.bounced), Icon: AlertTriangle, grad: 'bg-gradient-to-r from-orange-500 to-red-600', text: 'text-orange-600', chip: 'bg-orange-50 border-orange-100' },
            ].map((c) => {
              const active = filter === (c.key as typeof filter);
              return (
                <button
                  key={c.key}
                  onClick={() => { setFilter(c.key as typeof filter); setCurrentPage(1); }}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all ${active ? `border-transparent text-white shadow-md ${c.grad}` : `${c.chip} hover:shadow-sm`}`}
                >
                  <c.Icon className={`h-4 w-4 ${active ? 'text-white' : c.text}`} />
                  <span className={`font-semibold ${active ? 'text-white' : 'text-gray-800'}`}>{c.label}</span>
                  <span className={`font-bold ${active ? 'text-white' : 'text-gray-900'}`}>{c.count.toLocaleString()}</span>
                  <span className={`text-[11px] font-medium ${active ? 'text-white/80' : 'text-gray-400'}`}>{c.pct}%</span>
                </button>
              );
            })}
            {filter !== 'all' && (
              <button onClick={() => { setFilter('all'); setCurrentPage(1); }} className="text-xs font-medium text-emerald-600 hover:underline ml-1">
                Clear filter · show all
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredEmails.length === 0 ? (
            <div className="p-12 text-center">
              <div className="h-16 w-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">
                {emails.length === 0 ? 'No emails sent yet' : `No ${filter === 'all' ? '' : filter + ' '}emails match`}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {emails.length === 0 ? 'Start a campaign to see email analytics here' : 'Try a different filter or search'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Recipient</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Subject</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Engagement</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sent At</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedEmails.map((email, index) => (
                  <motion.tr
                    key={email.id}
                    className="hover:bg-gray-50 transition-colors"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 + index * 0.02 }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-lg">
                          {(email.recipient_name || email.recipient_email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{email.recipient_name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500">{email.recipient_email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <p className="font-medium text-gray-900 truncate">{email.subject}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        const g = engagementOf(email);
                        const label = g.bounced ? 'Bounced' : g.replied ? 'Replied' : g.clicked ? 'Clicked' : g.opened ? 'Opened' : 'Sent';
                        const cls = g.bounced ? 'bg-red-50 text-red-700 border-red-200'
                          : g.replied ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : g.clicked ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : g.opened ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-50 text-gray-600 border-gray-200';
                        return <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>{label}</span>;
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-4">
                        {email.opens > 0 && (
                          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
                            <Eye className="h-4 w-4" />
                            <span className="text-sm font-medium">{email.opens}</span>
                          </div>
                        )}
                        {email.clicks > 0 && (
                          <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                            <MousePointerClick className="h-4 w-4" />
                            <span className="text-sm font-medium">{email.clicks}</span>
                          </div>
                        )}
                        {email.opens === 0 && email.clicks === 0 && (
                          <span className="text-sm text-gray-400">No activity</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="h-4 w-4" />
                        {formatDate(email.sent_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => setDetailId(email.id)}
                        className="text-emerald-600 hover:text-emerald-700 font-medium text-sm"
                      >
                        View Details
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {filteredEmails.length > pageSize && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50/60">
            <p className="text-sm text-gray-600">
              Page {safePage} of {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(() => Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && p - arr[idx - 1] > 1 && <span className="px-1 text-gray-400">…</span>}
                    <button
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[2.25rem] px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        p === safePage
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow'
                          : 'text-gray-700 hover:bg-white border border-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                onClick={() => setCurrentPage(() => Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
                className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Email detail + activity thread */}
      <EmailDetailModal emailId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  delay: number;
  trend?: 'up' | 'down';
}

function StatCard({ title, value, subtitle, icon: Icon, gradient, delay, trend }: StatCardProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 relative overflow-hidden group hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`} />
      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div className={`h-12 w-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          {trend && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${trend === 'up' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
              {trend === 'up' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          )}
        </div>
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">{title}</h3>
        <p className="text-3xl font-bold text-gray-900 mb-2">{value}</p>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </motion.div>
  );
}
