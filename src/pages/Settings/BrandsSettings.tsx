/**
 * BrandsSettings — platform-admin brand catalog.
 *
 * GET   /api/brands          list brands with member/lead/campaign/sent counts
 * POST  /api/brands          create a brand (caller becomes its admin)
 * PATCH /api/brands/{id}     edit / activate / deactivate
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import {
  Building2, Plus, Pencil, Loader2, X, Shield, CheckCircle2, XCircle, ArrowRightLeft,
  Users, Target, Megaphone, Send, Globe, RefreshCw,
} from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useAuth } from '../../hooks/useAuth';
import {
  API_BASE, buildBrandPatch, emptyBrandForm, errorDetail, escapeHtml,
  effectiveSendingEnabled, formFromBrand, isDefaultBrand, normalizeDomain, parseHostnames,
  validateBrandForm, type BrandFormState, type BrandRow, type JsonObject,
} from './brandForm';
import { BrandFormFields } from './BrandFormFields';

const fmt = (n?: number | null) => (typeof n === 'number' ? n.toLocaleString() : '—');

export function BrandsSettings() {
  const { isPlatformAdmin, activeBrand, switchBrand } = useAuth();
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<BrandRow | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchBrands = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API_BASE}/api/brands`, { headers: { ...authHeaders() }, cache: 'no-store' });
      if (!r.ok) throw new Error(await errorDetail(r, 'Failed to load brands'));
      setBrands((await r.json()).brands || []);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load brands');
    }
    setLoading(false);
  };
  useEffect(() => { if (isPlatformAdmin) fetchBrands(); }, [isPlatformAdmin]);

  const doSwitch = async (b: BrandRow) => {
    setBusyId(b.id);
    // On success the page fully reloads into the new brand.
    const { error } = await switchBrand(b.id);
    if (error) Swal.fire({ icon: 'error', title: 'Could not switch brand', text: error.message || '' });
    setBusyId(null);
  };

  const toggleActive = async (b: BrandRow) => {
    const next = !b.is_active;
    if (!next) {
      if (isDefaultBrand(b.id)) return; // never deactivate the live default brand from here
      const c = await Swal.fire({
        icon: 'warning',
        title: `Deactivate ${b.display_name}?`,
        text: 'Its members can no longer use it and its sending stops. Data is kept and the brand can be re-activated.',
        showCancelButton: true,
        confirmButtonText: 'Deactivate',
        confirmButtonColor: '#dc2626',
      });
      if (!c.isConfirmed) return;
    }
    setBusyId(b.id);
    const res = await fetch(`${API_BASE}/api/brands/${b.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Update failed', text: await errorDetail(res) });
    setBusyId(null);
    fetchBrands();
  };

  const onCreated = async (b: BrandRow) => {
    setEditing(null);
    fetchBrands();
    const c = await Swal.fire({
      icon: 'success',
      title: 'Brand created',
      html: `<div style="text-align:left"><b>${escapeHtml(b.display_name || b.slug)}</b> <code>${escapeHtml(b.slug || '')}</code><br>` +
        `<span style="font-size:13px;color:#666">You are its admin. Sending is ${effectiveSendingEnabled(b) ? 'enabled' : 'disabled'}; ` +
        `connect its mailboxes and set up campaigns before enabling sending.</span></div>`,
      showCancelButton: true,
      confirmButtonText: 'Switch to this brand',
      cancelButtonText: 'Stay here',
      confirmButtonColor: '#7c3aed',
    });
    if (c.isConfirmed && b.id) doSwitch(b);
  };

  if (!isPlatformAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Platform admins only</p>
        <p className="text-sm text-gray-500 mt-1">Only platform administrators can create and configure brands.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Brands</h2>
            <p className="text-sm text-gray-500">Every brand is fully isolated: its own team, mailboxes, leads, campaigns and sending</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchBrands} title="Refresh"
            className="p-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow hover:shadow-lg transition-all">
            <Plus className="h-4 w-4" /> New Brand
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading && brands.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-red-600 text-sm mb-3">{error}</p>
            <button onClick={fetchBrands} className="btn-secondary">Try again</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">Brand</th>
                  <th className="px-4 py-3 text-right"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Members</span></th>
                  <th className="px-4 py-3 text-right"><span className="inline-flex items-center gap-1"><Target className="h-3.5 w-3.5" />Leads</span></th>
                  <th className="px-4 py-3 text-right"><span className="inline-flex items-center gap-1"><Megaphone className="h-3.5 w-3.5" />Campaigns</span></th>
                  <th className="px-4 py-3 text-right"><span className="inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" />Sent</span></th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {brands.map((b) => {
                  const current = activeBrand?.id === b.id;
                  const sending = effectiveSendingEnabled(b);
                  return (
                    <tr key={b.id} className={current ? 'bg-indigo-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{b.display_name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[11px] font-mono">{b.slug}</span>
                          {current && <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold uppercase tracking-wide">Current</span>}
                          {isDefaultBrand(b.id) && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">Default</span>}
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                          <Globe className="h-3.5 w-3.5" />{b.website_domain || 'no website'}
                          {(b.hostnames || []).length > 0 && <span className="text-gray-400"> · {(b.hostnames || []).join(', ')}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(b.member_count)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(b.lead_count)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(b.campaign_count)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(b.sent_count)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => toggleActive(b)} disabled={busyId === b.id || (isDefaultBrand(b.id) && !!b.is_active)}
                            title={isDefaultBrand(b.id) && b.is_active ? 'The default brand cannot be deactivated' : b.is_active ? 'Deactivate brand' : 'Activate brand'}
                            className={`inline-flex items-center gap-1 text-xs font-medium disabled:cursor-default ${b.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {b.is_active ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            {b.is_active ? 'Active' : 'Inactive'}
                          </button>
                          <span className={`inline-flex w-fit px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                            sending ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            Sending {sending ? 'on' : 'off'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!current && b.is_active && (
                            <button onClick={() => doSwitch(b)} disabled={busyId === b.id} title="Switch to this brand"
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                              {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />} Switch
                            </button>
                          )}
                          <button onClick={() => setEditing(b)} title="Edit brand"
                            className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600"><Pencil className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {brands.length === 0 && <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No brands yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <BrandModal
            brand={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); fetchBrands(); }}
            onCreated={onCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BrandModal({ brand, onClose, onSaved, onCreated }: {
  brand: BrandRow | null;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (b: BrandRow) => void;
}) {
  const isNew = !brand;
  const [initial] = useState<BrandFormState>(() => (brand ? formFromBrand(brand) : emptyBrandForm()));
  const [form, setForm] = useState<BrandFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    const v = validateBrandForm(form, { requireSlug: isNew });
    if (v) { setErr(v); return; }
    setErr('');

    if (isNew) {
      // Create: send every filled-in value; sending_enabled always explicit (default OFF)
      const patch = buildBrandPatch(null, emptyBrandForm(), form, { includeHostnames: true, forceSendingEnabled: true });
      const body: JsonObject = {
        slug: form.slug.trim(),
        display_name: form.display_name.trim(),
        website_domain: normalizeDomain(form.website_domain) || null,
        hostnames: parseHostnames(form.hostnames),
        sender: patch.sender,
      };
      if (patch.branding) body.branding = patch.branding;
      setSaving(true);
      try {
        const res = await fetch(`${API_BASE}/api/brands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await errorDetail(res, 'Failed to create brand'));
        const data = await res.json().catch(() => null);
        const created: BrandRow = data?.brand ?? data ?? { ...body, id: '' };
        setSaving(false);
        onCreated(created);
      } catch (e) {
        setErr((e as Error)?.message || 'Failed to create brand');
        setSaving(false);
      }
      return;
    }

    const patch = buildBrandPatch(brand, initial, form, { includeHostnames: true });
    if (Object.keys(patch).length === 0) { onClose(); return; }
    if (initial.sending_enabled && !form.sending_enabled) {
      const c = await Swal.fire({
        icon: 'warning',
        title: `Stop sending for ${brand!.display_name}?`,
        text: 'The daily sender will stop emailing this brand’s campaigns until sending is enabled again.',
        showCancelButton: true,
        confirmButtonText: 'Disable sending',
        confirmButtonColor: '#dc2626',
      });
      if (!c.isConfirmed) return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/brands/${brand!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await errorDetail(res, 'Failed to save brand'));
      setSaving(false);
      onSaved();
    } catch (e) {
      setErr((e as Error)?.message || 'Failed to save brand');
      setSaving(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="w-full max-w-3xl bg-gray-50 rounded-2xl shadow-2xl my-4"
        initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 bg-white rounded-t-2xl">
          <h3 className="font-bold text-gray-900 text-lg">{isNew ? 'New Brand' : `Edit ${brand!.display_name}`}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          <BrandFormFields value={form} onChange={setForm} isNew={isNew} canEditHostnames brandId={brand?.id} disabled={saving} />
          {isDefaultBrand(brand?.id) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
              This is the default (live) brand. Only fields you change are saved; untouched fields keep their current behaviour.
            </p>
          )}
          {err && <p className="text-sm text-red-600 mt-4">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-gray-200 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium disabled:opacity-50">
            {saving ? 'Saving…' : isNew ? 'Create Brand' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
