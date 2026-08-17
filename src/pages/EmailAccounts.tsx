import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Mail,
  Send,
  Eye,
  MessageCircle,
  RefreshCw,
  XCircle,
  Users,
  Activity,
  Calendar,
  Zap,
  Plus,
  CheckCircle,
  Trash2,
  Loader2
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface AccountStats {
  total_sent: number;
  sent_today: number;
  sent_this_week: number;
  remaining_today: number;
  opened: number;
  clicked: number;
  replied: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
}

interface EmailAccount {
  id: string;
  email: string;
  sender_name: string;
  sender_title: string;
  persona: string;
  focus_area: string;
  status: string;
  health_score: number;
  daily_limit: number;
  stats: AccountStats;
}

interface AccountsSummary {
  total_accounts: number;
  total_daily_limit: number;
  total_sent_today: number;
  remaining_today: number;
  total_sent_all_time: number;
  avg_health_score: number;
  usage_percentage: number;
}

export function EmailAccounts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [summary, setSummary] = useState<AccountsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Array<{ name: string; email: string; title: string; focus: string }>>([]);
  const [baseAccount, setBaseAccount] = useState<string | null>(null);

  // Handle OAuth callback messages from URL
  useEffect(() => {
    const success = searchParams.get('success');
    const errorParam = searchParams.get('error');
    const email = searchParams.get('email');

    if (success === 'connected' && email) {
      setSuccessMessage(`Successfully connected ${email}`);
      // Clear URL params
      setSearchParams({});
      // Refresh data
      fetchData();
    } else if (success === 'updated' && email) {
      setSuccessMessage(`Successfully updated ${email}`);
      setSearchParams({});
      fetchData();
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        'access_denied': 'Access was denied. Please try again.',
        'no_code': 'No authorization code received.',
        'no_email': 'Could not retrieve email from Google.',
        'callback_failed': 'OAuth callback failed. Please try again.'
      };
      setError(errorMessages[errorParam] || `OAuth error: ${errorParam}`);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const [accountsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/email-accounts/`),
        fetch(`${API_BASE}/api/email-accounts/stats`)
      ]);

      if (!accountsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch email accounts data');
      }

      const accountsData = await accountsRes.json();
      const summaryData = await summaryRes.json();

      setAccounts(accountsData.accounts || []);
      setSummary(summaryData);
      setError(null);

      // Sending personas (AI team) — the identities campaigns rotate through
      try {
        const pRes = await fetch(`${API_BASE}/api/email-accounts/personas`);
        if (pRes.ok) {
          const pData = await pRes.json();
          setPersonas(pData.personas || []);
          setBaseAccount(pData.base_account || null);
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email accounts data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const connectGmail = async () => {
    try {
      setConnecting(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/email-accounts/google/auth`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to start OAuth flow');
      }

      const data = await response.json();

      if (data.auth_url) {
        // Redirect to Google OAuth
        window.location.href = data.auth_url;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Gmail');
      setConnecting(false);
    }
  };

  const disconnectAccount = async (accountId: string, email: string) => {
    if (!confirm(`Are you sure you want to disconnect ${email}?`)) {
      return;
    }

    try {
      setDisconnecting(accountId);

      const response = await fetch(`${API_BASE}/api/email-accounts/google/${accountId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to disconnect account');
      }

      setSuccessMessage(`Successfully disconnected ${email}`);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect account');
    } finally {
      setDisconnecting(null);
    }
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-emerald-500';
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
          <p className="mt-4 text-gray-600 font-medium">Loading email accounts...</p>
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

  if (!summary) return null;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Email Accounts Management
              </h1>
              <p className="text-gray-600 text-sm mt-0.5">
                Monitor sender accounts, quotas, and performance metrics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="font-medium text-sm">Refresh</span>
            </button>

            <button
              onClick={connectGmail}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="font-medium text-sm">Connect Gmail</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Success Message */}
      {successMessage && (
        <motion.div
          className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
          </div>
        </motion.div>
      )}

      {/* Sending Personas (AI Team) */}
      {personas.length > 0 && (
        <motion.div
          className="mb-6 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center shadow">
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Sending Personas</h2>
              <p className="text-gray-500 text-xs">
                Campaigns rotate through these identities
                {baseAccount ? <> — all sent via <span className="font-medium text-gray-700">{baseAccount}</span></> : null}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {personas.map((p) => (
              <div key={p.email} className="border border-gray-200 rounded-xl p-4 hover:border-purple-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center text-purple-700 font-semibold">
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500 truncate">{p.title}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-sm text-gray-700">
                  <Mail className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="truncate">{p.email}</span>
                </div>
                {p.focus && <p className="mt-2 text-xs text-gray-500 line-clamp-2">{p.focus}</p>}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Open Rate Disclaimer */}
      <motion.div
        className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <div className="h-8 w-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <Eye className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-900 mb-1">
              Note About Open Rates
            </h3>
            <p className="text-sm text-amber-800 leading-relaxed">
              Open rates may appear lower than actual opens because most email clients (Gmail, Outlook, Apple Mail)
              block tracking pixels by default for privacy. Industry average is 20-30% tracked opens.
              <strong className="font-semibold"> Focus on click rates and replies</strong> as more reliable engagement metrics.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <SummaryCard
          title="Total Accounts"
          value={summary.total_accounts}
          subtitle="Active sender accounts"
          icon={Users}
          gradient="from-purple-500 to-purple-600"
          delay={0}
        />

        <SummaryCard
          title="Sent Today"
          value={summary.total_sent_today}
          subtitle={`of ${summary.total_daily_limit} daily limit`}
          icon={Send}
          gradient="from-blue-500 to-blue-600"
          delay={0.1}
        />

        <SummaryCard
          title="Remaining Today"
          value={summary.remaining_today}
          subtitle={`${summary.usage_percentage}% capacity used`}
          icon={Zap}
          gradient="from-emerald-500 to-emerald-600"
          delay={0.2}
        />

        <SummaryCard
          title="Total Sent"
          value={summary.total_sent_all_time}
          subtitle="All-time emails sent"
          icon={Mail}
          gradient="from-amber-500 to-amber-600"
          delay={0.3}
        />
      </div>

      {/* Accounts Grid */}
      {accounts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {accounts.map((account, index) => (
            <AccountCard
              key={account.id}
              account={account}
              delay={0.4 + index * 0.1}
              onDisconnect={disconnectAccount}
              isDisconnecting={disconnecting === account.id}
            />
          ))}
        </div>
      ) : (
        <motion.div
          className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="h-16 w-16 bg-gradient-to-br from-red-100 to-red-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="h-8 w-8 text-red-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">No Email Accounts Connected</h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Connect your Gmail account to start sending personalized AI-generated emails to your leads.
          </p>
          <button
            onClick={connectGmail}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl hover:from-red-600 hover:to-red-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
            <span className="font-medium">Connect Gmail Account</span>
          </button>
        </motion.div>
      )}

      {/* Daily Usage Overview */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Daily Quota Overview</h2>
            <p className="text-sm text-gray-600">Combined sending capacity across all accounts</p>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Total Usage</span>
            <span className="text-sm font-bold text-gray-900">
              {summary.total_sent_today} / {summary.total_daily_limit} emails
            </span>
          </div>
          <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full ${getUsageColor(summary.usage_percentage)} transition-all duration-500`}
              style={{ width: `${Math.min(summary.usage_percentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Individual Account Bars */}
        <div className="space-y-3 mt-6">
          {accounts.map((account) => {
            const usagePercent = (account.stats.sent_today / account.daily_limit) * 100;
            return (
              <div key={account.id} className="flex items-center gap-4">
                <div className="w-32 flex-shrink-0">
                  <p className="text-sm font-medium text-gray-900">{account.sender_name}</p>
                  <p className="text-xs text-gray-500">{account.sender_title}</p>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600">
                      {account.stats.sent_today} / {account.daily_limit}
                    </span>
                    <span className="text-xs font-medium text-gray-900">{Math.round(usagePercent)}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getUsageColor(usagePercent)} transition-all duration-500`}
                      style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  delay: number;
}

function SummaryCard({ title, value, subtitle, icon: Icon, gradient, delay }: SummaryCardProps) {
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
        </div>

        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          {title}
        </h3>

        <div className="flex items-baseline gap-2 mb-2">
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>

        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </motion.div>
  );
}

interface AccountCardProps {
  account: EmailAccount;
  delay: number;
  onDisconnect: (accountId: string, email: string) => void;
  isDisconnecting: boolean;
}

function AccountCard({ account, delay, onDisconnect, isDisconnecting }: AccountCardProps) {
  const usagePercent = (account.stats.sent_today / account.daily_limit) * 100;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'paused':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'blocked':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getHealthColor = (health: number) => {
    if (health >= 80) return 'text-emerald-600 bg-emerald-50';
    if (health >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
    >
      {/* Account Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
            {account.sender_name.charAt(0)}
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{account.sender_name}</h3>
            <p className="text-sm text-gray-600">{account.sender_title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{account.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(account.status)}`}>
            {account.status}
          </span>
          <button
            onClick={() => onDisconnect(account.id, account.email)}
            disabled={isDisconnecting}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            title="Disconnect account"
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Persona & Focus */}
      <div className="mb-4 p-3 bg-gray-50 rounded-xl">
        <p className="text-xs text-gray-600 mb-1">
          <span className="font-semibold">Persona:</span> {account.persona}
        </p>
        <p className="text-xs text-gray-600">
          <span className="font-semibold">Focus:</span> {account.focus_area}
        </p>
      </div>

      {/* Health Score */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-600">Health Score</span>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-lg ${getHealthColor(account.health_score)}`}>
          <Activity className="h-4 w-4" />
          <span className="font-bold">{account.health_score}%</span>
        </div>
      </div>

      {/* Daily Quota */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Today's Quota</span>
          <span className="text-sm font-bold text-gray-900">
            {account.stats.sent_today} / {account.daily_limit}
          </span>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${getUsageColor(usagePercent)} transition-all duration-500`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {account.stats.remaining_today} emails remaining today
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-200">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Send className="h-4 w-4 text-blue-600" />
            <p className="text-lg font-bold text-gray-900">{account.stats.total_sent}</p>
          </div>
          <p className="text-xs text-gray-600">Total Sent</p>
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Eye className="h-4 w-4 text-amber-600" />
            <p className="text-lg font-bold text-gray-900">{account.stats.open_rate}%</p>
          </div>
          <p className="text-xs text-gray-600">Open Rate</p>
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            <p className="text-lg font-bold text-gray-900">{account.stats.reply_rate}%</p>
          </div>
          <p className="text-xs text-gray-600">Reply Rate</p>
        </div>
      </div>

      {/* Engagement Details */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100">
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">{account.stats.opened}</p>
          <p className="text-xs text-gray-500">Opened</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">{account.stats.clicked}</p>
          <p className="text-xs text-gray-500">Clicked</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">{account.stats.replied}</p>
          <p className="text-xs text-gray-500">Replied</p>
        </div>
      </div>

      {/* This Week */}
      <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-medium text-gray-700">This Week</span>
          </div>
          <span className="text-lg font-bold text-purple-700">{account.stats.sent_this_week}</span>
        </div>
      </div>
    </motion.div>
  );
}
