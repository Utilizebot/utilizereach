import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EmailDetailModal } from '../components/EmailDetailModal';
import {
  Users,
  Mail,
  Eye,
  MousePointerClick,
  MessageCircle,
  TrendingUp,
  Filter,
  Search,
  AlertCircle,
  Clock,
  BarChart3,
  Sparkles,
  Upload,
  Rocket,
  Target,
  RefreshCw,
  Zap,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface LeadStats {
  total_leads: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  rates: {
    open_rate: number;
    click_rate: number;
    reply_rate: number;
    bounce_rate: number;
  };
}

interface Lead {
  id: string;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  sent_at: string;
  status: string;
  opens_count: number;
  clicks_count: number;
  replies_count: number;
}

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function LeadFunnel() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailsStatus, setDetailsStatus] = useState<'opened' | 'replied' | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([fetchStats(), fetchLeads()]);
    } catch (err) {
      setError('Failed to load data. Please check if the backend is running.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleSyncReplies = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/leads/sync-replies`, { method: 'POST' });
      const data = await res.json();
      setSyncResult(`${data.replies_found} repl${data.replies_found === 1 ? 'y' : 'ies'} found out of ${data.checked} emails checked`);
      await fetchData();
    } catch {
      setSyncResult('Sync failed — check connection');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 6000);
    }
  };

  const fetchStats = async () => {
    const response = await fetch(`${API_BASE}/api/leads/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    const data = await response.json();
    setStats(data);
  };

  const fetchLeads = async () => {
    // Use the new sent-emails endpoint that returns proper engagement data
    const response = await fetch(`${API_BASE}/api/leads/sent-emails?limit=100`);
    if (!response.ok) throw new Error('Failed to fetch leads');
    const data = await response.json();
    setLeads(data.leads || []);
  };

  // Filter leads based on search and status
  const filteredLeads = leads.filter(lead => {
    const matchesSearch =
      lead.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.recipient_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.subject?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredLeads.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedLeads = filteredLeads.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, itemsPerPage]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string; icon: any }> = {
      'replied': { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: MessageCircle },
      'clicked': { bg: 'bg-blue-50', text: 'text-blue-700', icon: MousePointerClick },
      'opened': { bg: 'bg-amber-50', text: 'text-amber-700', icon: Eye },
      'sent': { bg: 'bg-gray-50', text: 'text-gray-700', icon: Mail },
      'bounced': { bg: 'bg-red-50', text: 'text-red-700', icon: AlertCircle },
      'unsubscribed': { bg: 'bg-gray-50', text: 'text-gray-500', icon: AlertCircle }
    };
    const badge = badges[status] || badges['sent'];
    const Icon = badge.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const safePercentage = (value: number, total: number): number => {
    if (!total || total === 0 || !value) return 0;
    return Math.round((value / total) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="inline-block h-16 w-16 border-4 border-blue-600 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="mt-4 text-gray-600 font-medium">Loading your lead funnel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full border border-red-100">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle className="h-8 w-8" />
            <h2 className="text-xl font-bold">Connection Error</h2>
          </div>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Premium Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              Lead Funnel Analytics
            </h1>
            <p className="text-gray-600 text-sm mt-0.5">
              Track your email campaign performance from send to conversion
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium"
            >
              {syncResult}
            </motion.span>
          )}
          <button
            onClick={handleSyncReplies}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <MessageCircle className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
            <span className="font-medium text-sm">{syncing ? 'Syncing…' : 'Sync Replies'}</span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="font-medium text-sm">Refresh</span>
          </button>
        </div>
      </motion.div>

      {/* Premium Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Leads"
            value={stats.total_leads}
            icon={Users}
            gradient="from-blue-500 to-blue-600"
            delay={0}
          />
          <StatCard
            title="Contacted"
            value={stats.contacted}
            subtitle={`${safePercentage(stats.contacted, stats.total_leads)}% of total`}
            icon={Mail}
            gradient="from-purple-500 to-purple-600"
            delay={0.1}
          />
          <StatCard
            title="Opened"
            value={stats.opened}
            subtitle={`${stats.rates?.open_rate || 0}% open rate`}
            icon={Eye}
            gradient="from-amber-500 to-orange-600"
            delay={0.2}
            highlight={stats.rates?.open_rate > 50}
            onClick={() => setDetailsStatus('opened')}
          />
          <StatCard
            title="Replied"
            value={stats.replied}
            subtitle={`${stats.rates?.reply_rate || 0}% reply rate`}
            icon={MessageCircle}
            gradient="from-emerald-500 to-green-600"
            delay={0.3}
            highlight={stats.rates?.reply_rate > 5}
            onClick={() => setDetailsStatus('replied')}
          />
        </div>
      )}

      {/* Premium Funnel Visualization */}
      {stats && (
        <motion.div
          className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 overflow-hidden relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {/* Decorative Background */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-purple-50 to-pink-50 rounded-full blur-3xl opacity-50 -z-0" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Conversion Funnel</h2>
            </div>

            <div className="space-y-4">
              <PremiumFunnelStep
                label="Total Leads"
                count={stats.total_leads}
                percentage={100}
                color="from-gray-400 to-gray-500"
              />
              <PremiumFunnelStep
                label="Contacted"
                count={stats.contacted}
                percentage={safePercentage(stats.contacted, stats.total_leads)}
                color="from-purple-400 to-purple-500"
              />
              <PremiumFunnelStep
                label="Opened"
                count={stats.opened}
                percentage={safePercentage(stats.opened, stats.total_leads)}
                color="from-amber-400 to-orange-500"
                conversionRate={safePercentage(stats.opened, stats.contacted)}
              />
              <PremiumFunnelStep
                label="Clicked"
                count={stats.clicked}
                percentage={safePercentage(stats.clicked, stats.total_leads)}
                color="from-blue-400 to-blue-500"
                conversionRate={safePercentage(stats.clicked, stats.opened)}
              />
              <PremiumFunnelStep
                label="Replied"
                count={stats.replied}
                percentage={safePercentage(stats.replied, stats.total_leads)}
                color="from-emerald-400 to-green-500"
                conversionRate={safePercentage(stats.replied, stats.clicked)}
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* Premium Leads Table */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        {/* Table Header */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-5 border-b border-gray-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold text-gray-900">
                Sent Emails
              </h2>
              <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                {filteredLeads.length} total
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search name, email, subject..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white shadow-sm w-64"
                />
              </div>

              {/* Status Filter */}
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all appearance-none bg-white shadow-sm cursor-pointer"
                >
                  <option value="all">All Status</option>
                  <option value="sent">Sent</option>
                  <option value="opened">Opened</option>
                  <option value="clicked">Clicked</option>
                  <option value="replied">Replied</option>
                  <option value="bounced">Bounced</option>
                </select>
              </div>

              {/* Items per page */}
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white shadow-sm cursor-pointer"
              >
                {ITEMS_PER_PAGE_OPTIONS.map(option => (
                  <option key={option} value={option}>{option} per page</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50/80 backdrop-blur">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Sent Date
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Engagement
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <AnimatePresence>
                {paginatedLeads.map((lead, index) => (
                  <motion.tr
                    key={lead.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: index * 0.02 }}
                    onClick={() => setDetailId(lead.id)}
                    className="hover:bg-purple-50/50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-lg">
                          {(lead.recipient_name || lead.recipient_email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {lead.recipient_name || 'Unknown'}
                          </p>
                          <p className="text-sm text-gray-500">
                            {lead.recipient_email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-900 max-w-xs truncate font-medium">
                        {lead.subject}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="h-4 w-4" />
                        {new Date(lead.sent_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(lead.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-4">
                        {lead.opens_count > 0 && (
                          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
                            <Eye className="h-4 w-4" />
                            <span className="text-sm font-medium">{lead.opens_count}</span>
                          </div>
                        )}
                        {lead.clicks_count > 0 && (
                          <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                            <MousePointerClick className="h-4 w-4" />
                            <span className="text-sm font-medium">{lead.clicks_count}</span>
                          </div>
                        )}
                        {lead.replies_count > 0 && (
                          <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                            <MessageCircle className="h-4 w-4" />
                            <span className="text-sm font-medium">{lead.replies_count}</span>
                          </div>
                        )}
                        {!lead.opens_count && !lead.clicks_count && !lead.replies_count && (
                          <span className="text-sm text-gray-400">No activity</span>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {filteredLeads.length === 0 && (
          <EmptyState
            hasFilters={searchTerm !== '' || statusFilter !== 'all'}
            onNavigate={navigate}
          />
        )}

        {/* Pagination */}
        {filteredLeads.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Showing info */}
              <p className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, filteredLeads.length)}</span> of{' '}
                <span className="font-semibold">{filteredLeads.length}</span> results
              </p>

              {/* Pagination controls */}
              <div className="flex items-center gap-2">
                {/* First page */}
                <button
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="First page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>

                {/* Previous page */}
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {/* Page numbers */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(page => {
                      // Show first, last, current, and pages around current
                      if (page === 1 || page === totalPages) return true;
                      if (Math.abs(page - currentPage) <= 1) return true;
                      return false;
                    })
                    .map((page, index, array) => {
                      // Add ellipsis if there's a gap
                      const showEllipsisBefore = index > 0 && page - array[index - 1] > 1;
                      return (
                        <div key={page} className="flex items-center">
                          {showEllipsisBefore && (
                            <span className="px-2 text-gray-400">...</span>
                          )}
                          <button
                            onClick={() => goToPage(page)}
                            className={`min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
                              currentPage === page
                                ? 'bg-purple-600 text-white shadow-md'
                                : 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      );
                    })}
                </div>

                {/* Next page */}
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                {/* Last page */}
                <button
                  onClick={() => goToPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Last page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Email detail + activity thread (opens on row click) */}
      <EmailDetailModal emailId={detailId} onClose={() => setDetailId(null)} />

      {/* Opened / Replied details modal */}
      <AnimatePresence>
        {detailsStatus && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/40 z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailsStatus(null)}
            />

            {/* Panel */}
            <motion.div
              className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            >
              {/* Header */}
              <div className={`px-6 py-5 border-b border-gray-200 flex items-center justify-between ${
                detailsStatus === 'opened'
                  ? 'bg-gradient-to-r from-amber-50 to-orange-50'
                  : 'bg-gradient-to-r from-emerald-50 to-green-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow ${
                    detailsStatus === 'opened'
                      ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                      : 'bg-gradient-to-br from-emerald-500 to-green-600'
                  }`}>
                    {detailsStatus === 'opened'
                      ? <Eye className="h-5 w-5 text-white" />
                      : <MessageCircle className="h-5 w-5 text-white" />
                    }
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 capitalize">
                      {detailsStatus} Emails
                    </h2>
                    <p className="text-sm text-gray-500">
                      {leads.filter(l => l.status === detailsStatus).length} contacts
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setDetailsStatus(null)}
                  className="p-2 hover:bg-white/60 rounded-lg transition-colors text-gray-500 hover:text-gray-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Lead list */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {leads.filter(l => l.status === detailsStatus).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                    {detailsStatus === 'opened'
                      ? <Eye className="h-12 w-12 opacity-30" />
                      : <MessageCircle className="h-12 w-12 opacity-30" />
                    }
                    <p className="font-medium">No {detailsStatus} emails yet</p>
                  </div>
                ) : (
                  leads.filter(l => l.status === detailsStatus).map(lead => (
                    <div
                      key={lead.id}
                      className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                    >
                      <div
                        className="h-10 w-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow flex-shrink-0 cursor-pointer"
                        onClick={() => { setDetailId(lead.id); setDetailsStatus(null); }}
                      >
                        {(lead.recipient_name || lead.recipient_email).charAt(0).toUpperCase()}
                      </div>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => { setDetailId(lead.id); setDetailsStatus(null); }}
                      >
                        <p className="font-medium text-gray-900 truncate">
                          {lead.recipient_name || 'Unknown'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{lead.recipient_email}</p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{lead.subject}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <p className="text-xs text-gray-400">
                          {new Date(lead.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        {detailsStatus === 'opened' && lead.opens_count > 0 && (
                          <span className="text-xs text-amber-600 font-medium">{lead.opens_count}× opened</span>
                        )}
                        {detailsStatus === 'replied' && lead.replies_count > 0 && (
                          <span className="text-xs text-emerald-600 font-medium">{lead.replies_count}× replied</span>
                        )}
                        {detailsStatus === 'opened' && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await fetch(`${API_BASE}/api/leads/sent-emails/${lead.id}/mark-replied`, { method: 'PATCH' });
                              await fetchData();
                              setDetailsStatus(null);
                            }}
                            className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline font-medium"
                          >
                            Mark replied
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Empty State Component with Quick Actions
function EmptyState({
  hasFilters,
  onNavigate
}: {
  hasFilters: boolean;
  onNavigate: (path: string) => void;
}) {
  if (hasFilters) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 bg-gray-100 rounded-full mb-4">
          <Search className="h-8 w-8 text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No leads match your filters</p>
        <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div className="py-12 px-6">
      <div className="max-w-2xl mx-auto text-center">
        {/* Icon */}
        <motion.div
          className="inline-flex items-center justify-center h-20 w-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-2xl mb-6"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Rocket className="h-10 w-10 text-purple-600" />
        </motion.div>

        {/* Title */}
        <h3 className="text-2xl font-bold text-gray-900 mb-3">
          No emails sent yet
        </h3>
        <p className="text-gray-600 mb-8 max-w-md mx-auto">
          Start your first email campaign to see your leads appear here with engagement tracking
        </p>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-4 max-w-xl mx-auto mb-8">
          <motion.button
            onClick={() => onNavigate('/leads-management')}
            className="group flex flex-col items-center p-5 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 hover:border-indigo-300 hover:shadow-lg transition-all"
            whileHover={{ y: -2 }}
          >
            <div className="h-12 w-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mb-3 shadow-lg group-hover:shadow-indigo-500/30 transition-shadow">
              <Upload className="h-6 w-6 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Import Leads</span>
            <span className="text-xs text-gray-500 mt-1">Upload your contact list</span>
          </motion.button>

          <motion.button
            onClick={() => onNavigate('/scraper')}
            className="group flex flex-col items-center p-5 bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl border border-orange-100 hover:border-orange-300 hover:shadow-lg transition-all"
            whileHover={{ y: -2 }}
          >
            <div className="h-12 w-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center mb-3 shadow-lg group-hover:shadow-orange-500/30 transition-shadow">
              <Target className="h-6 w-6 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Scrape Leads</span>
            <span className="text-xs text-gray-500 mt-1">Find decision makers</span>
          </motion.button>

          <motion.button
            onClick={() => onNavigate('/leads-management')}
            className="group flex flex-col items-center p-5 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-100 hover:border-emerald-300 hover:shadow-lg transition-all"
            whileHover={{ y: -2 }}
          >
            <div className="h-12 w-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center mb-3 shadow-lg group-hover:shadow-emerald-500/30 transition-shadow">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Start Campaign</span>
            <span className="text-xs text-gray-500 mt-1">Send AI-powered emails</span>
          </motion.button>
        </div>

        {/* How it works */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-6 text-left">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            How the Lead Funnel Works
          </h4>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 h-8 w-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 font-bold text-sm">1</div>
              <div>
                <p className="font-medium text-gray-900 text-sm">Import Leads</p>
                <p className="text-xs text-gray-500">Upload Excel/CSV or scrape</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 h-8 w-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 font-bold text-sm">2</div>
              <div>
                <p className="font-medium text-gray-900 text-sm">Launch Campaign</p>
                <p className="text-xs text-gray-500">AI writes personalized emails</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 h-8 w-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 font-bold text-sm">3</div>
              <div>
                <p className="font-medium text-gray-900 text-sm">Track Engagement</p>
                <p className="text-xs text-gray-500">Opens, clicks, replies</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 h-8 w-8 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 font-bold text-sm">4</div>
              <div>
                <p className="font-medium text-gray-900 text-sm">Convert</p>
                <p className="text-xs text-gray-500">Turn leads into customers</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Premium Stat Card Component
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  gradient,
  delay,
  highlight,
  onClick
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: any;
  gradient: string;
  delay: number;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.div
      className={`bg-white rounded-2xl shadow-lg border border-gray-200 p-6 relative overflow-hidden group hover:shadow-xl transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
      onClick={onClick}
    >
      {/* Decorative gradient background */}
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`} />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <p className="text-4xl font-bold text-gray-900">{value.toLocaleString()}</p>
            {subtitle && (
              <p className="text-sm text-gray-500 mt-2">{subtitle}</p>
            )}
          </div>
          <div className={`h-12 w-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>

        {highlight && (
          <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
            <TrendingUp className="h-4 w-4" />
            <span>Above average</span>
          </div>
        )}
        {onClick && (
          <p className="text-xs text-gray-400 mt-3 group-hover:text-gray-600 transition-colors">
            Click to view details →
          </p>
        )}
      </div>
    </motion.div>
  );
}

// Premium Funnel Step Component
function PremiumFunnelStep({
  label,
  count,
  percentage,
  color,
  conversionRate
}: {
  label: string;
  count: number;
  percentage: number;
  color: string;
  conversionRate?: number;
}) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">{label}</span>
          {conversionRate !== undefined && conversionRate > 0 && (
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
              {conversionRate}% conversion
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">{count.toLocaleString()}</span>
          <span className="text-xs text-gray-500">({percentage}%)</span>
        </div>
      </div>

      <div className="relative">
        <div className="w-full bg-gray-100 rounded-full h-8 shadow-inner">
          <motion.div
            className={`h-8 rounded-full bg-gradient-to-r ${color} shadow-lg relative overflow-hidden`}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
          >
            {/* Shimmer effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />

            {percentage > 15 && (
              <div className="absolute inset-0 flex items-center justify-end pr-3">
                <span className="text-xs font-bold text-white drop-shadow-lg">
                  {percentage}%
                </span>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
