/**
 * SchedulerSettings Component
 *
 * Settings page for automated daily email campaign scheduler
 *
 * Features:
 * - Enable/disable toggle
 * - Daily limit configuration
 * - Send time configuration
 * - Run history display
 * - Manual trigger button
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Play,
  History,
  Settings,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Calendar,
  RefreshCw
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface SchedulerConfig {
  id: string;
  is_enabled: boolean;
  daily_limit: number;
  send_hour: number;
  send_minute: number;
  timezone: string;
  delay_between_emails: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_sent_count: number;
  last_run_error: string | null;
  next_run_at: string | null;
  total_runs: number;
  total_emails_sent: number;
}

interface RunHistory {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  leads_attempted: number;
  emails_sent: number;
  emails_failed: number;
  error_message: string | null;
}

interface SchedulerStatus {
  is_enabled: boolean;
  pending_leads: number;
  today_sent: number;
  daily_limit: number;
  send_time: string;
}

export function SchedulerSettings() {
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [history, setHistory] = useState<RunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state for editing
  const [formData, setFormData] = useState({
    is_enabled: false,
    daily_limit: 30,
    send_hour: 10,
    send_minute: 0,
    delay_between_emails: 60
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [settingsRes, statusRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/api/scheduler/settings`),
        fetch(`${API_BASE}/api/scheduler/status`),
        fetch(`${API_BASE}/api/scheduler/history?limit=10`)
      ]);

      const settings = await settingsRes.json();
      const statusData = await statusRes.json();
      const historyData = await historyRes.json();

      setConfig(settings);
      setStatus(statusData);
      setHistory(historyData.runs || []);

      setFormData({
        is_enabled: settings.is_enabled || false,
        daily_limit: settings.daily_limit || 30,
        send_hour: settings.send_hour || 10,
        send_minute: settings.send_minute || 0,
        delay_between_emails: settings.delay_between_emails || 60
      });
    } catch (err) {
      setError('Failed to load scheduler settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/scheduler/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to save settings');
      }

      setSuccessMessage('Settings saved successfully!');
      await fetchData();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    const newState = !formData.is_enabled;
    setFormData(prev => ({ ...prev, is_enabled: newState }));

    try {
      const response = await fetch(`${API_BASE}/api/scheduler/toggle?enable=${newState}`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to toggle scheduler');
      }

      setSuccessMessage(newState ? 'Scheduler enabled!' : 'Scheduler disabled');
      await fetchData();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message);
      setFormData(prev => ({ ...prev, is_enabled: !newState }));
    }
  };

  const handleRunNow = async () => {
    if (!formData.is_enabled) {
      setError('Please enable the scheduler first');
      return;
    }

    setTriggering(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/scheduler/run-now`, {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to trigger campaign');
      }

      setSuccessMessage('Campaign triggered! Check history for results.');
      setTimeout(() => {
        fetchData();
        setSuccessMessage(null);
      }, 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTriggering(false);
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle size={12} /> Success
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <AlertCircle size={12} /> Partial
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <XCircle size={12} /> Failed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <Loader2 size={12} className="animate-spin" /> Running
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            N/A
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Automated Campaigns</h2>
          <p className="text-gray-600 mt-1">
            Configure automatic daily email campaigns
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Messages */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
        >
          <XCircle className="text-red-500" size={20} />
          <p className="text-red-700">{error}</p>
        </motion.div>
      )}

      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="text-green-500" size={20} />
          <p className="text-green-700">{successMessage}</p>
        </motion.div>
      )}

      {/* Main Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
      >
        {/* Enable/Disable Toggle Section */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${formData.is_enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                <Clock className={formData.is_enabled ? 'text-green-600' : 'text-gray-400'} size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Daily Campaign Scheduler</h3>
                <p className="text-sm text-gray-600">
                  Automatically send {formData.daily_limit} emails daily at {formData.send_hour.toString().padStart(2, '0')}:{formData.send_minute.toString().padStart(2, '0')} Malaysia Time
                </p>
              </div>
            </div>
            <button
              onClick={handleToggle}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                formData.is_enabled ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                  formData.is_enabled ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Status Overview */}
        {status && (
          <div className="p-6 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-600">Pending Leads</p>
                <p className="text-2xl font-bold text-gray-900">{status.pending_leads}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-600">Sent Today</p>
                <p className="text-2xl font-bold text-blue-600">{status.today_sent}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-600">Total Runs</p>
                <p className="text-2xl font-bold text-gray-900">{config?.total_runs || 0}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-600">Total Sent</p>
                <p className="text-2xl font-bold text-green-600">{config?.total_emails_sent || 0}</p>
              </div>
            </div>
          </div>
        )}

        {/* Configuration Form */}
        <div className="p-6 space-y-6">
          {/* Daily Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Daily Email Limit
            </label>
            <input
              type="number"
              value={formData.daily_limit}
              onChange={(e) => setFormData(prev => ({ ...prev, daily_limit: parseInt(e.target.value) || 30 }))}
              min={1}
              max={100}
              className="w-full md:w-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum emails to send per day (1-100). Recommended: 30 for new accounts.
            </p>
          </div>

          {/* Send Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Send Time (Malaysia Time - UTC+8)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={formData.send_hour}
                onChange={(e) => setFormData(prev => ({ ...prev, send_hour: parseInt(e.target.value) || 10 }))}
                min={0}
                max={23}
                className="w-20 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-center"
              />
              <span className="text-xl font-bold text-gray-400">:</span>
              <input
                type="number"
                value={formData.send_minute}
                onChange={(e) => setFormData(prev => ({ ...prev, send_minute: parseInt(e.target.value) || 0 }))}
                min={0}
                max={59}
                className="w-20 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-center"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Campaigns will run daily at this time.
            </p>
          </div>

          {/* Delay Between Emails */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Delay Between Emails (seconds)
            </label>
            <input
              type="number"
              value={formData.delay_between_emails}
              onChange={(e) => setFormData(prev => ({ ...prev, delay_between_emails: parseInt(e.target.value) || 60 }))}
              min={30}
              max={300}
              className="w-full md:w-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Wait time between each email (minimum 30s for rate limiting).
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Settings size={18} />
              )}
              {saving ? 'Saving...' : 'Save Settings'}
            </button>

            <button
              onClick={handleRunNow}
              disabled={triggering || !formData.is_enabled}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                formData.is_enabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {triggering ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Play size={18} />
              )}
              {triggering ? 'Triggering...' : 'Run Now'}
            </button>
          </div>
        </div>

        {/* Next/Last Run Info */}
        {config && (
          <div className="p-6 bg-gray-50 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <Calendar className="text-blue-500" size={20} />
                <div>
                  <p className="text-sm text-gray-600">Next Scheduled Run</p>
                  <p className="font-medium text-gray-900">
                    {config.is_enabled && config.next_run_at
                      ? formatDateTime(config.next_run_at)
                      : 'Not scheduled (scheduler disabled)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <History className="text-purple-500" size={20} />
                <div>
                  <p className="text-sm text-gray-600">Last Run</p>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">
                      {formatDateTime(config.last_run_at)}
                    </p>
                    {getStatusBadge(config.last_run_status)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Run History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <History className="text-gray-400" size={24} />
            <h3 className="text-lg font-semibold text-gray-900">Run History</h3>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <History className="mx-auto mb-3 text-gray-300" size={48} />
            <p>No run history yet</p>
            <p className="text-sm">Campaign runs will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Attempted
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sent
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Failed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {history.map((run) => {
                  const duration = run.completed_at && run.started_at
                    ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000 / 60)
                    : null;

                  return (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDateTime(run.started_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(run.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {run.leads_attempted}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                        {run.emails_sent}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                        {run.emails_failed}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {duration !== null ? `${duration} min` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
