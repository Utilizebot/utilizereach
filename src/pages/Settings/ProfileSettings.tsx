/**
 * ProfileSettings Component
 *
 * User profile management and UTM defaults configuration
 *
 * Phase: 1.11 - Profile Settings Page
 * Created: 2025-10-16
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Save,
  Link2,
  Copy,
  Check,
  AlertCircle
} from 'lucide-react';
import { useAuth, generateCampaignLink } from '../../hooks/useAuth';

export function ProfileSettings() {
  const { salesRep, updateProfile, loading } = useAuth();

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmDefaultCampaign, setUtmDefaultCampaign] = useState('');

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);

  // Initialize form with current user data
  useEffect(() => {
    if (salesRep) {
      setFullName(salesRep.full_name);
      setEmail(salesRep.email);
      setUtmSource(salesRep.utm_source || 'email');
      setUtmMedium(salesRep.utm_medium || 'campaign');
      setUtmDefaultCampaign(salesRep.utm_default_campaign || '');
    }
  }, [salesRep]);

  // Generate preview campaign link
  const previewLink = salesRep
    ? generateCampaignLink(
        {
          ...salesRep,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_default_campaign: utmDefaultCampaign,
        },
        utmDefaultCampaign || undefined
      )
    : '';

  // Handle save
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(false);
    setSaveError('');
    setIsSaving(true);

    try {
      const { error } = await updateProfile({
        full_name: fullName,
        email: email,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_default_campaign: utmDefaultCampaign || null,
      });

      if (error) {
        throw error;
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error saving profile:', err);
      setSaveError(err.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle copy link
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(previewLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  if (!salesRep) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center text-gray-600">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Profile Settings</h2>
        <p className="text-gray-600 mt-1">
          Manage your account information and campaign defaults
        </p>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <motion.div
          className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Check className="text-green-600" size={20} />
          <p className="text-green-800 font-medium">Profile updated successfully!</p>
        </motion.div>
      )}

      {/* Error Message */}
      {saveError && (
        <motion.div
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertCircle className="text-red-600" size={20} />
          <p className="text-red-800">{saveError}</p>
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Personal Information Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <User size={20} className="text-primary" />
            Personal Information
          </h3>

          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field"
                placeholder="John Doe"
                required
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <Mail size={16} className="inline mr-1" />
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="john@company.com"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                This email is used for login and communications
              </p>
            </div>

            {/* Role (Read-only) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Role
              </label>
              <div className="px-4 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <span className="font-medium text-gray-900">
                  {salesRep.role === 'admin' ? 'Administrator' : 'Sales Representative'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Contact an administrator to change your role
              </p>
            </div>
          </div>
        </div>

        {/* UTM Campaign Defaults Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Link2 size={20} className="text-primary" />
            Campaign Link Defaults
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            These UTM parameters will be automatically added to your campaign links
          </p>

          <div className="space-y-4">
            {/* UTM Source */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                UTM Source
              </label>
              <input
                type="text"
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                className="input-field"
                placeholder="email"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Where the traffic originates (e.g., email, linkedin, newsletter)
              </p>
            </div>

            {/* UTM Medium */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                UTM Medium
              </label>
              <input
                type="text"
                value={utmMedium}
                onChange={(e) => setUtmMedium(e.target.value)}
                className="input-field"
                placeholder="campaign"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                The marketing medium (e.g., campaign, social, referral)
              </p>
            </div>

            {/* UTM Default Campaign */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Default Campaign Name
              </label>
              <input
                type="text"
                value={utmDefaultCampaign}
                onChange={(e) => setUtmDefaultCampaign(e.target.value)}
                className="input-field"
                placeholder="oct_25"
              />
              <p className="text-xs text-gray-500 mt-1">
                Your default campaign identifier (e.g., oct_25, q4_2025)
              </p>
            </div>
          </div>
        </div>

        {/* Campaign Link Preview Section */}
        <div className="bg-gradient-to-br from-blue-50 to-white rounded-2xl shadow-sm border border-blue-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Link2 size={20} className="text-primary" />
            Campaign Link Preview
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            This is how your campaign link will look with current settings
          </p>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 font-mono text-sm text-gray-700 break-all">
                {previewLink}
              </div>
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex-shrink-0 p-2 text-gray-600 hover:text-primary hover:bg-blue-50 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check size={20} className="text-green-600" />
                ) : (
                  <Copy size={20} />
                )}
              </button>
            </div>
          </div>

          {copied && (
            <motion.p
              className="text-sm text-green-600 font-medium mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Link copied to clipboard!
            </motion.p>
          )}

          {/* UTM Parameters Breakdown */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-semibold text-gray-700 mb-2">
              UTM Parameters:
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-600">utm_source:</span>
                <span className="ml-2 font-medium text-gray-900">{utmSource}</span>
              </div>
              <div>
                <span className="text-gray-600">utm_medium:</span>
                <span className="ml-2 font-medium text-gray-900">{utmMedium}</span>
              </div>
              <div>
                <span className="text-gray-600">utm_campaign:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {utmDefaultCampaign || 'general'}
                </span>
              </div>
              <div>
                <span className="text-gray-600">sales_rep_id:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {salesRep.id.substring(0, 8)}...
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <motion.button
            type="submit"
            disabled={isSaving || loading}
            className="btn-primary flex items-center gap-2 px-8"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isSaving ? (
              <>
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={20} />
                <span>Save Changes</span>
              </>
            )}
          </motion.button>
        </div>
      </form>

      {/* Account Info */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Account Information</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Account ID:</span>
            <span className="font-mono text-gray-900">{salesRep.id.substring(0, 16)}...</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Member Since:</span>
            <span className="text-gray-900">
              {new Date(salesRep.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
          </div>
          {salesRep.last_login && (
            <div className="flex justify-between">
              <span className="text-gray-600">Last Login:</span>
              <span className="text-gray-900">
                {new Date(salesRep.last_login).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
