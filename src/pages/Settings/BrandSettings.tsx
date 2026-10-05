/**
 * BrandSettings — edit the ACTIVE brand (display name, website, branding,
 * sender settings) via GET/PATCH /api/brands/current.
 *
 * Requires settings.manage (route-guarded in App.tsx, re-checked here).
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';
import { Building2, Save, Check, AlertCircle, Loader2, Shield, RotateCcw } from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useAuth } from '../../hooks/useAuth';
import {
  API_BASE, buildBrandPatch, errorDetail, formFromBrand, validateBrandForm,
  type BrandFormState, type BrandRow,
} from './brandForm';
import { BrandFormFields } from './BrandFormFields';

export function BrandSettings() {
  const { can, activeBrand } = useAuth();
  const canManage = can('settings.manage');

  const [brand, setBrand] = useState<BrandRow | null>(null);
  const [initial, setInitial] = useState<BrandFormState | null>(null);
  const [form, setForm] = useState<BrandFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`${API_BASE}/api/brands/current`, { headers: { ...authHeaders() }, cache: 'no-store' });
      if (!res.ok) throw new Error(await errorDetail(res, 'Failed to load brand'));
      const data = await res.json();
      const row: BrandRow = data?.brand ?? data;
      const f = formFromBrand(row);
      setBrand(row);
      setInitial(f);
      setForm(f);
    } catch (e) {
      setLoadError((e as Error)?.message || 'Failed to load brand');
    }
    setLoading(false);
  };

  // Reload when the active brand changes (brand switch)
  useEffect(() => {
    if (canManage) load();
  }, [canManage, activeBrand?.id]);

  if (!canManage) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Brand admins only</p>
        <p className="text-sm text-gray-500 mt-1">You need permission to manage settings for this brand.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex items-center justify-center text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading brand…
      </div>
    );
  }

  if (loadError || !brand || !form || !initial) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Could not load brand settings</p>
        <p className="text-sm text-gray-500 mt-1 mb-4">{loadError}</p>
        <button onClick={load} className="btn-secondary">Try again</button>
      </div>
    );
  }

  const patch = buildBrandPatch(brand, initial, form);
  const dirty = Object.keys(patch).length > 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess(false);
    const err = validateBrandForm(form);
    if (err) { setSaveError(err); return; }
    if (!dirty) return;

    if (initial.sending_enabled && !form.sending_enabled) {
      const c = await Swal.fire({
        icon: 'warning',
        title: `Stop sending for ${brand.display_name}?`,
        text: 'The daily sender will stop emailing this brand’s campaigns until sending is enabled again.',
        showCancelButton: true,
        confirmButtonText: 'Disable sending',
        confirmButtonColor: '#dc2626',
      });
      if (!c.isConfirmed) return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/brands/current`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await errorDetail(res, 'Failed to save brand'));
      const data = await res.json().catch(() => null);
      const row: BrandRow | null = data?.brand ?? (data?.id ? data : null);
      if (row) {
        const f = formFromBrand(row);
        setBrand(row);
        setInitial(f);
        setForm(f);
      } else {
        await load();
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError((e as Error)?.message || 'Failed to save brand');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Brand Settings</h2>
          <p className="text-gray-600 text-sm mt-0.5">
            Identity, branding and sending for <b className="text-gray-900">{brand.display_name}</b>
            <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-mono">{brand.slug}</span>
          </p>
        </div>
      </div>

      {saveSuccess && (
        <motion.div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <Check className="text-green-600" size={20} />
          <p className="text-green-800 font-medium">Brand settings saved.</p>
        </motion.div>
      )}
      {saveError && (
        <motion.div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <AlertCircle className="text-red-600" size={20} />
          <p className="text-red-800">{saveError}</p>
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <BrandFormFields value={form} onChange={setForm} brandId={brand.id} disabled={saving} />

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => { setForm(initial); setSaveError(''); }} disabled={!dirty || saving}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <RotateCcw size={18} /> Reset
          </button>
          <motion.button type="submit" disabled={!dirty || saving} className="btn-primary flex items-center gap-2 px-8"
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </motion.button>
        </div>
      </form>
    </div>
  );
}
