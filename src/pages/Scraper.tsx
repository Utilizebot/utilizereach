/**
 * Scraper Page - Lead Scraping Interface
 *
 * Allows users to configure and start lead scraping jobs
 * Supports 23 countries + global targeting
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Globe,
  Settings as SettingsIcon,
  Play,
  Loader,
  AlertCircle,
  CheckCircle,
  Info,
  Database,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { JobHistory } from '../components/JobHistory';

export function Scraper() {
  const { isAuthenticated, initializing } = useAuth();

  // Form state
  const [formData, setFormData] = useState({
    search_query: '',
    location: 'malaysia',
    num_queries: 10,
    industry: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const { startScrapingJob } = await import('../lib/api');

      const response = await startScrapingJob({
        search_query: formData.search_query,
        location: formData.location,
        num_queries: formData.num_queries,
        industry: formData.industry || undefined,
      });

      setSuccess(
        `Scraping job started successfully! Job ID: ${response.job_id}. Check Job History below for progress.`
      );
      setFormData({
        search_query: '',
        location: 'malaysia',
        num_queries: 10,
        industry: '',
      });
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start scraping job');
      setLoading(false);
    }
  };

  // Wait for auth state to resolve before showing any auth error
  if (initializing) return null;

  // Authentication check
  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <motion.div
          className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600">Please log in to access the lead scraper.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 bg-gradient-to-br from-orange-600 to-red-600 rounded-xl flex items-center justify-center shadow-lg">
            <Database className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              Lead Scraper
            </h1>
            <p className="text-gray-600 text-sm mt-0.5">
              Find decision-makers from 23 countries worldwide
            </p>
          </div>
        </div>
      </motion.div>

      {/* Success Message */}
      {success && (
        <motion.div
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="h-8 w-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <CheckCircle className="text-emerald-600" size={18} />
          </div>
          <div>
            <p className="text-emerald-900 font-semibold">Success!</p>
            <p className="text-emerald-800 text-sm">{success}</p>
          </div>
        </motion.div>
      )}

      {/* Error Message */}
      {error && (
        <motion.div
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="h-8 w-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <AlertCircle className="text-red-600" size={18} />
          </div>
          <div>
            <p className="text-red-900 font-semibold">Error</p>
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        </motion.div>
      )}

      {/* Main Form Card */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Search Query */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Search className="inline mr-2" size={18} />
              Search Query
            </label>
            <input
              type="text"
              value={formData.search_query}
              onChange={(e) => setFormData({ ...formData, search_query: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              placeholder="e.g., manufacturing automation, warehouse robotics, logistics companies"
              required
              minLength={3}
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Describe the type of companies or industry you want to target
            </p>
          </div>

          {/* Location Selector - 23 Countries! */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Globe className="inline mr-2" size={18} />
              Target Location
            </label>
            <select
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all bg-white"
              required
            >
                <optgroup label="🌏 Asia-Pacific">
                  <option value="malaysia">🇲🇾 Malaysia</option>
                  <option value="singapore">🇸🇬 Singapore</option>
                  <option value="australia">🇦🇺 Australia</option>
                  <option value="new_zealand">🇳🇿 New Zealand</option>
                  <option value="india">🇮🇳 India</option>
                  <option value="china">🇨🇳 China</option>
                  <option value="japan">🇯🇵 Japan</option>
                  <option value="south_korea">🇰🇷 South Korea</option>
                  <option value="thailand">🇹🇭 Thailand</option>
                  <option value="indonesia">🇮🇩 Indonesia</option>
                  <option value="philippines">🇵🇭 Philippines</option>
                  <option value="vietnam">🇻🇳 Vietnam</option>
                </optgroup>

                <optgroup label="🌍 Europe">
                  <option value="uk">🇬🇧 United Kingdom</option>
                  <option value="germany">🇩🇪 Germany</option>
                  <option value="france">🇫🇷 France</option>
                  <option value="spain">🇪🇸 Spain</option>
                  <option value="italy">🇮🇹 Italy</option>
                  <option value="netherlands">🇳🇱 Netherlands</option>
                </optgroup>

                <optgroup label="🏜️ Middle East">
                  <option value="uae">🇦🇪 United Arab Emirates</option>
                </optgroup>

                <optgroup label="🌎 Americas">
                  <option value="us">🇺🇸 United States</option>
                  <option value="canada">🇨🇦 Canada</option>
                  <option value="brazil">🇧🇷 Brazil</option>
                  <option value="mexico">🇲🇽 Mexico</option>
                </optgroup>

                <optgroup label="🌐 Global">
                  <option value="global">🌍 Global (Worldwide)</option>
                </optgroup>
              </select>
            <p className="text-xs text-gray-500 mt-1.5">
              Select the country/region to target for lead generation
            </p>
          </div>

          {/* Number of Queries */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <SettingsIcon className="inline mr-2" size={18} />
              Number of Search Queries
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                value={formData.num_queries}
                onChange={(e) =>
                  setFormData({ ...formData, num_queries: parseInt(e.target.value) })
                }
                min="5"
                max="20"
                step="1"
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
              <span className="text-lg font-bold text-orange-600 w-12 text-center bg-orange-50 rounded-lg py-1">
                {formData.num_queries}
              </span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>5 (Quick)</span>
              <span>10 (Standard)</span>
              <span>15 (Comprehensive)</span>
              <span>20 (Max)</span>
            </div>
            <p className="text-xs text-gray-600 mt-3 flex items-start gap-2 bg-gray-50 p-3 rounded-lg">
              <Info size={14} className="flex-shrink-0 mt-0.5 text-gray-500" />
              <span>
                <strong>Recommended: 10-15 queries</strong> for best results. Each query searches different variations (cities, domains, business types).
              </span>
            </p>
          </div>

          {/* Optional: Industry Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Industry (Optional)
            </label>
            <input
              type="text"
              value={formData.industry}
              onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              placeholder="e.g., Manufacturing, Logistics, Healthcare"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Leave blank to search all industries, or specify to narrow results
            </p>
          </div>

          {/* Info Box */}
          <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-5">
            <h3 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
              <Info size={18} />
              What You'll Get
            </h3>
            <ul className="text-sm text-orange-800 space-y-2 grid md:grid-cols-2 gap-2">
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Executive contacts (CEOs, Directors, VPs)
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Company emails and phone numbers
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Decision-maker names and titles
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Source URLs for verification
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Relevance scores for each lead
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle size={14} className="text-orange-600" />
                Downloadable CSV with all data
              </li>
            </ul>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-xl font-semibold text-lg hover:shadow-lg hover:shadow-orange-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader className="animate-spin" size={22} />
                Starting Scraping Job...
              </>
            ) : (
              <>
                <Play size={22} />
                Start Scraping
              </>
            )}
          </button>
        </form>
      </motion.div>

      {/* Info Section */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 bg-gradient-to-br from-orange-600 to-red-600 rounded-xl flex items-center justify-center">
            <Info className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">How It Works</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-gray-50 rounded-xl p-5">
            <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg mb-4">
              <Search className="text-white" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">1. Smart Search</h3>
            <p className="text-sm text-gray-600">
              Our scraper generates multiple targeted queries using your keywords, local business
              entities, and city variations
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-5">
            <div className="h-12 w-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg mb-4">
              <Globe className="text-white" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">2. Location-Aware</h3>
            <p className="text-sm text-gray-600">
              Searches are geo-targeted using local Google domains, languages, and business
              suffixes specific to each country
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-5">
            <div className="h-12 w-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg mb-4">
              <CheckCircle className="text-white" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">3. Quality Filtering</h3>
            <p className="text-sm text-gray-600">
              URLs are scored for relevance, executive pages are prioritized, and contacts are
              verified before export
            </p>
          </div>
        </div>
      </motion.div>

      {/* Job History - Real-time tracking */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <JobHistory />
      </motion.div>
    </div>
  );
}
