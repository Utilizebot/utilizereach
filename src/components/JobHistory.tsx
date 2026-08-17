/**
 * Job History Component
 *
 * Displays scraping jobs with real-time progress tracking
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Loader,
  CheckCircle,
  AlertCircle,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { getJobs, downloadJobCSV, downloadBrevoCSV, type ScrapingJob } from '../lib/api';

export function JobHistory() {
  const [jobs, setJobs] = useState<ScrapingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Fetch jobs
  const fetchJobs = async (showRefreshState = false) => {
    if (showRefreshState) setRefreshing(true);

    try {
      const response = await getJobs({ limit: 10, offset: 0 });
      setJobs(response.jobs);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Load jobs on mount
  useEffect(() => {
    fetchJobs();

    // Auto-refresh every 5 seconds if there are running jobs
    const interval = setInterval(() => {
      const hasRunningJobs = jobs.some(
        (job) => job.status === 'running' || job.status === 'pending'
      );
      if (hasRunningJobs) {
        fetchJobs();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [jobs]);

  // Handle Raw CSV download
  const handleDownload = async (jobId: string) => {
    try {
      await downloadJobCSV(jobId);
    } catch (err: any) {
      alert(err.message || 'Failed to download CSV');
    }
  };

  // Handle Brevo CSV download
  const handleDownloadBrevo = async (jobId: string) => {
    try {
      await downloadBrevoCSV(jobId);
    } catch (err: any) {
      alert(err.message || 'Failed to download Brevo CSV');
    }
  };

  // Status badge component
  const StatusBadge = ({ status }: { status: string }) => {
    const configs = {
      pending: {
        icon: Clock,
        bg: 'bg-yellow-100',
        text: 'text-yellow-800',
        border: 'border-yellow-300',
        spin: false,
      },
      running: {
        icon: Loader,
        bg: 'bg-blue-100',
        text: 'text-blue-800',
        border: 'border-blue-300',
        spin: true,
      },
      completed: {
        icon: CheckCircle,
        bg: 'bg-green-100',
        text: 'text-green-800',
        border: 'border-green-300',
        spin: false,
      },
      failed: {
        icon: AlertCircle,
        bg: 'bg-red-100',
        text: 'text-red-800',
        border: 'border-red-300',
        spin: false,
      },
    };

    const config = configs[status as keyof typeof configs] || configs.pending;
    const Icon = config.icon;

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border}`}
      >
        <Icon size={14} className={config.spin ? 'animate-spin' : ''} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center">
        <Loader className="mx-auto animate-spin text-primary mb-4" size={32} />
        <p className="text-gray-600">Loading job history...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
        <AlertCircle className="mx-auto text-red-500 mb-4" size={32} />
        <p className="text-red-800 font-medium mb-2">Failed to Load Jobs</p>
        <p className="text-red-700 text-sm mb-4">{error}</p>
        <button onClick={() => fetchJobs(true)} className="btn-secondary">
          Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (jobs.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center">
        <Clock className="mx-auto text-gray-400 mb-4" size={48} />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Jobs Yet</h3>
        <p className="text-gray-600">
          Start a scraping job above to see it appear here with real-time progress tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Job History</h2>
        <button
          onClick={() => fetchJobs(true)}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {jobs.map((job, index) => (
          <motion.div
            key={job.id}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            {/* Job Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">{job.job_name}</h3>
                <p className="text-sm text-gray-600">
                  Query: <span className="font-medium">{job.search_query}</span> •{' '}
                  Location: <span className="font-medium">{job.location.toUpperCase()}</span>
                </p>
              </div>
              <StatusBadge status={job.status} />
            </div>

            {/* Progress Bar (for running jobs) */}
            {(job.status === 'running' || job.status === 'pending') && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>{job.current_step || 'Initializing...'}</span>
                  <span>{job.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Job Stats */}
            <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
              <span>
                Raw Leads: <strong className="text-gray-900">{job.leads_found}</strong>
              </span>
              <span>•</span>
              <span>
                Brevo Ready: <strong className="text-green-600">{job.brevo_ready_count || 0}</strong>
              </span>
              <span>•</span>
              <span>
                Queries: <strong className="text-gray-900">{job.num_queries}</strong>
              </span>
              {job.created_at && (
                <>
                  <span>•</span>
                  <span>
                    Started:{' '}
                    <strong className="text-gray-900">
                      {new Date(job.created_at).toLocaleString()}
                    </strong>
                  </span>
                </>
              )}
            </div>

            {/* Error Message */}
            {job.status === 'failed' && job.error_message && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded p-2">
                <p className="text-xs text-red-800">
                  <strong>Error:</strong> {job.error_message}
                </p>
              </div>
            )}

            {/* Actions */}
            {job.status === 'completed' && (
              <div className="mt-3 flex gap-2 flex-wrap">
                <button
                  onClick={() => handleDownload(job.id)}
                  className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
                >
                  <Download size={14} />
                  Raw CSV ({job.leads_found})
                </button>
                <button
                  onClick={() => handleDownloadBrevo(job.id)}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm py-1.5 px-3 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                  disabled={!job.brevo_ready_count || job.brevo_ready_count === 0}
                  title={job.brevo_ready_count ? 'Download Brevo-ready leads' : 'No Brevo-ready leads'}
                >
                  <Download size={14} />
                  Brevo CSV ({job.brevo_ready_count || 0})
                </button>
                <button
                  onClick={() => window.open(`/jobs/${job.id}`, '_blank')}
                  className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
                >
                  <ExternalLink size={14} />
                  View Details
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
