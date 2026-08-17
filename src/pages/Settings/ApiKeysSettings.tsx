/**
 * API Keys Settings Component
 *
 * Manage SerpAPI keys (each sales rep has their own keys)
 * Usage limits are managed by SerpAPI, not tracked here
 *
 * Phase: 2 - API Keys Management
 * Created: 2025-10-16
 * Updated: 2025-10-17 - Simplified (removed usage tracking)
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  X,
} from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useAuth } from '../../hooks/useAuth';
import type { ApiKey } from '../../types/scraper';

/**
 * Authenticated request against the /api/api-keys backend
 */
async function apiKeysRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/api-keys${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || `Request failed: ${response.status}`);
  }

  return response.json();
}

export function ApiKeysSettings() {
  const { salesRep, initializing } = useAuth();

  // State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state (simplified - no usage limit needed)
  const [formData, setFormData] = useState({
    key_name: '',
    api_key: '',
    provider: 'serpapi' as const,
  });

  // Fetch API keys on mount
  useEffect(() => {
    fetchApiKeys();
  }, [salesRep]);

  const fetchApiKeys = async () => {
    if (!salesRep) return;

    try {
      setLoading(true);
      const data = await apiKeysRequest<ApiKey[]>('/');

      setApiKeys(data || []);
    } catch (err: any) {
      console.error('Error fetching API keys:', err);
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (!salesRep) throw new Error('Not authenticated');

      await apiKeysRequest('/', {
        method: 'POST',
        body: JSON.stringify({
          key_name: formData.key_name,
          api_key: formData.api_key,
          provider: formData.provider,
          usage_limit: 999999, // High default - SerpAPI handles actual limits
        }),
      });

      setSuccess('API key added successfully!');
      setShowAddModal(false);
      setFormData({
        key_name: '',
        api_key: '',
        provider: 'serpapi',
      });
      fetchApiKeys();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error adding API key:', err);
      setError(err.message || 'Failed to add API key');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;

    setError('');
    setSuccess('');

    try {
      const updates: any = {
        key_name: formData.key_name,
      };

      // Only update API key if it was changed
      if (formData.api_key && formData.api_key !== '••••••••••••••••') {
        updates.api_key = formData.api_key;
      }

      await apiKeysRequest(`/${editingKey.id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      setSuccess('API key updated successfully!');
      setEditingKey(null);
      setFormData({
        key_name: '',
        api_key: '',
        provider: 'serpapi',
      });
      fetchApiKeys();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error updating API key:', err);
      setError(err.message || 'Failed to update API key');
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm('Are you sure you want to delete this API key?')) return;

    setError('');
    setSuccess('');

    try {
      await apiKeysRequest(`/${keyId}`, {
        method: 'DELETE',
      });

      setSuccess('API key deleted successfully!');
      fetchApiKeys();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error deleting API key:', err);
      setError(err.message || 'Failed to delete API key');
    }
  };

  const toggleVisibility = (keyId: string) => {
    const newVisible = new Set(visibleKeys);
    if (newVisible.has(keyId)) {
      newVisible.delete(keyId);
    } else {
      newVisible.add(keyId);
    }
    setVisibleKeys(newVisible);
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••••••••••';
    return key.substring(0, 4) + '••••••••••••' + key.substring(key.length - 4);
  };

  const startEdit = (key: ApiKey) => {
    setEditingKey(key);
    setFormData({
      key_name: key.key_name,
      api_key: '••••••••••••••••', // Show masked, user can replace
      provider: key.provider,
    });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setFormData({
      key_name: '',
      api_key: '',
      provider: 'serpapi',
    });
  };

  // Wait for auth state to resolve before showing any auth error
  if (initializing) return null;

  // All authenticated sales reps can manage their own API keys
  if (!salesRep) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600">
            Please log in to manage your API keys.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">Loading API keys...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">API Keys Management</h2>
          <p className="text-gray-600 mt-1">
            Manage SerpAPI keys for lead scraping
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={20} />
          Add New Key
        </button>
      </div>

      {/* Success Message */}
      {success && (
        <motion.div
          className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Check className="text-green-600" size={20} />
          <p className="text-green-800 font-medium">{success}</p>
        </motion.div>
      )}

      {/* Error Message */}
      {error && (
        <motion.div
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <X className="text-red-600" size={20} />
          <p className="text-red-800">{error}</p>
        </motion.div>
      )}

      {/* API Keys List */}
      {apiKeys.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
          <Key size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No API Keys Yet</h3>
          <p className="text-gray-600 mb-6">
            Add your first SerpAPI key to start scraping leads
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus size={20} />
            Add First Key
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {apiKeys.map((key) => {
            const isVisible = visibleKeys.has(key.id);

            return (
              <motion.div
                key={key.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${key.is_active ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Key size={24} className={key.is_active ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{key.key_name}</h3>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-sm text-gray-600">
                          Provider: <span className="font-medium">SerpAPI</span>
                        </span>
                        <span className={`text-sm px-2 py-1 rounded-full ${
                          key.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {key.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(key)}
                      className="p-2 text-gray-600 hover:text-primary hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit key"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete key"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* API Key Display */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-xs text-gray-600 mb-1">API Key</p>
                      <p className="font-mono text-sm text-gray-900">
                        {isVisible ? key.api_key_encrypted : maskKey(key.api_key_encrypted)}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleVisibility(key.id)}
                      className="ml-4 p-2 text-gray-600 hover:text-gray-900 transition-colors"
                      title={isVisible ? 'Hide key' : 'Show key'}
                    >
                      {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Metadata */}
                <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
                  <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
                  {key.last_used && (
                    <span>Last used: {new Date(key.last_used).toLocaleDateString()}</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingKey) && (
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setShowAddModal(false);
              cancelEdit();
            }}
          >
            <motion.div
              className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingKey ? 'Edit API Key' : 'Add New API Key'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    cancelEdit();
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={editingKey ? handleEdit : handleAdd} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Key Name
                  </label>
                  <input
                    type="text"
                    value={formData.key_name}
                    onChange={(e) => setFormData({ ...formData, key_name: e.target.value })}
                    className="input-field"
                    placeholder="My SerpAPI Key"
                    required
                    minLength={3}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    A friendly name to identify this key
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    API Key
                  </label>
                  <input
                    type="text"
                    value={formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    className="input-field font-mono"
                    placeholder="Your SerpAPI key"
                    required={!editingKey}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {editingKey
                      ? 'Leave masked to keep existing key, or enter new key to update'
                      : 'Get your key from serpapi.com (usage limits managed by SerpAPI)'}
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      cancelEdit();
                    }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex-1"
                  >
                    {editingKey ? 'Update Key' : 'Add Key'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
