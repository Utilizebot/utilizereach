import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import {
  Users, UserPlus, KeyRound, Trash2, ShieldCheck, Shield, X, Loader2,
  CheckCircle2, XCircle, Copy, Building2, Star,
} from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL || '';
const MEMBERS_URL = `${API_BASE}/api/brands/current/members`;

/** A member of the ACTIVE brand (GET /api/brands/current/members). */
interface Member {
  id: string; email: string; full_name: string; role: string; role_label?: string;
  is_default?: boolean; is_active: boolean; last_login?: string | null; is_platform_admin?: boolean;
}

// Mirrors backend api/permissions.py role set (roles are per brand).
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', description: 'Full control, including team, mailboxes, API keys and system settings.' },
  { value: 'manager', label: 'Manager', description: 'Runs campaigns, leads, sending and analytics. Cannot manage users, credentials or settings.' },
  { value: 'member', label: 'Member', description: 'Creates and runs campaigns, imports and works leads, sends email.' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access to dashboards, campaigns, leads and analytics.' },
];
const canonicalRole = (r: string) => (r === 'sales_rep' ? 'member' : r);
const roleStyle = (r: string) =>
  r === 'admin' ? 'bg-purple-100 text-purple-700'
    : r === 'manager' ? 'bg-indigo-100 text-indigo-700'
      : r === 'member' ? 'bg-gray-100 text-gray-600'
        : 'bg-amber-100 text-amber-700';
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function detail(res: Response, fallback: string) {
  try { const b = await res.json(); return typeof b?.detail === 'string' ? b.detail : fallback; } catch { return fallback; }
}

function suggestPassword(name: string) {
  const base = (name || 'User').trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, '') || 'User';
  const cap = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  return `${cap}2026!`;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function UsersSettings() {
  const { can, activeBrand, salesRep, isPlatformAdmin } = useAuth();
  const canView = can('users.view');
  const canManage = can('users.manage');
  const brandName = activeBrand?.display_name || 'this brand';
  const [users, setUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await fetch(MEMBERS_URL, { headers: { ...authHeaders() }, cache: 'no-store' });
      if (r.ok) setUsers((await r.json()).members || []);
      else setLoadError(await detail(r, 'Failed to load members'));
    } catch { setLoadError('Failed to load members'); }
    setLoading(false);
  };
  // Re-fetch when the active brand changes (brand switch)
  useEffect(() => {
    if (canView) fetchUsers();
  }, [canView, activeBrand?.id]);

  const changeRole = async (u: Member, next: string) => {
    if (next === canonicalRole(u.role)) return;
    setBusyId(u.id);
    const res = await fetch(`${MEMBERS_URL}/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ role: next }),
    });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Cannot change role', text: await detail(res, '') });
    setBusyId(null);
    fetchUsers();
  };
  // Account (de)activation is global (all brands): platform admins only.
  const toggleActive = async (u: Member) => {
    setBusyId(u.id);
    const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Cannot change status', text: await detail(res, '') });
    setBusyId(null);
    fetchUsers();
  };
  const removeUser = async (u: Member) => {
    const c = await Swal.fire({
      title: `Remove ${u.full_name || u.email} from ${brandName}?`,
      text: 'They lose access to this brand immediately. Their account and access to other brands are kept.',
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Remove',
    });
    if (!c.isConfirmed) return;
    setBusyId(u.id);
    const res = await fetch(`${MEMBERS_URL}/${u.id}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Cannot remove member', text: await detail(res, '') });
    setBusyId(null);
    fetchUsers();
  };

  if (!canView) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Managers and admins only</p>
        <p className="text-sm text-gray-500 mt-1">You need permission to view the team.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Users</h2>
            <p className="text-sm text-gray-500 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              Team of <b className="text-gray-800">{brandName}</b>
              {canManage ? ' · add members, set roles, reset passwords' : ' · read-only'}
            </p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow hover:shadow-lg transition-all">
            <UserPlus className="h-4 w-4" /> Add Member
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
        ) : loadError ? (
          <div className="py-12 text-center">
            <p className="text-red-600 text-sm mb-3">{loadError}</p>
            <button onClick={fetchUsers} className="btn-secondary">Try again</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Last login</th>
                  {canManage && <th className="px-6 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => {
                  const role = canonicalRole(u.role);
                  const isSelf = salesRep?.id === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          {u.full_name || '—'}
                          {isSelf && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-semibold uppercase">You</span>}
                          {u.is_platform_admin && (
                            <span title="Platform admin: admin in every brand" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-semibold uppercase">
                              <Star className="h-3 w-3" />Platform
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">{u.email}</div>
                      </td>
                      <td className="px-6 py-3">
                        {canManage && !isSelf ? (
                          <select value={role} onChange={(e) => changeRole(u, e.target.value)} disabled={busyId === u.id} title="Change role in this brand"
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border-0 cursor-pointer focus:ring-2 focus:ring-indigo-500 ${roleStyle(role)}`}>
                            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${roleStyle(role)}`}>
                            {role === 'admin' ? <ShieldCheck className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                            {u.role_label || roleLabel(role)}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {isPlatformAdmin && !isSelf ? (
                          <button onClick={() => toggleActive(u)} disabled={busyId === u.id}
                            title={u.is_active ? 'Deactivate account (all brands)' : 'Activate account'}
                            className={`inline-flex items-center gap-1 text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {u.is_active ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            {u.is_active ? 'Active' : 'Inactive'}
                          </button>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {u.is_active ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">{fmtDate(u.last_login)}</td>
                      {canManage && (
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setResetFor(u)} title="Reset password"
                              className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600"><KeyRound className="h-4 w-4" /></button>
                            <button onClick={() => removeUser(u)} disabled={isSelf || busyId === u.id}
                              title={isSelf ? 'You cannot remove yourself' : `Remove from ${brandName}`}
                              className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {users.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="px-6 py-10 text-center text-gray-400">No members yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && canManage && <AddUserModal brandName={brandName} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); fetchUsers(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {resetFor && canManage && <ResetModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>{children}</div>;
}

function AddUserModal({ brandName, onClose, onDone }: { brandName: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setErr('Enter a valid email'); return; }
    if (password && password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setSaving(true); setErr('');
    const body: Record<string, string> = { email: em, role };
    if (name.trim()) body.full_name = name.trim();
    if (password) body.password = password;
    const res = await fetch(MEMBERS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) { setErr(await detail(res, 'Failed to add member')); return; }
    const data = await res.json().catch(() => ({}));
    // `created` tells whether a brand-new account was made (vs. an existing user added)
    const created: boolean | undefined = data?.created ?? data?.user_created;
    // an existing account only takes the password when it never had one (legacy profile)
    const showPassword = !!password && created !== false;
    Swal.fire({
      icon: 'success', title: created === false ? 'Existing user added' : 'Member added',
      html: `<div style="text-align:left"><b>${escapeHtml(em)}</b> → ${escapeHtml(brandName)} as ${escapeHtml(roleLabel(role))}` +
        (showPassword
          ? `<br>Password${created === undefined ? ' (if a new account was created)' : ''}: <code>${escapeHtml(password)}</code><br><span style="font-size:12px;color:#888">Share it securely; they can change it under Profile.</span>`
          : created === false ? '<br><span style="font-size:12px;color:#888">They sign in with their existing password and can switch to this brand.</span>' : '') +
        '</div>',
      confirmButtonColor: '#7c3aed',
    });
    onDone();
  };

  return (
    <ModalShell title={`Add Member to ${brandName}`} onClose={onClose}>
      <div className="p-5 space-y-4">
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" /></Field>
        <Field label="Full name (new accounts)"><input value={name} onChange={(e) => { setName(e.target.value); if (!password) setPassword(suggestPassword(e.target.value)); }}
          placeholder="e.g. Syeefa Wadhiah" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role in this brand">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Password (new accounts)">
            <div className="flex gap-1">
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="optional" className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
              <button type="button" onClick={() => setPassword(suggestPassword(name))} title="Suggest" className="px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">↻</button>
            </div>
          </Field>
        </div>
        <p className="text-xs text-gray-500">{ROLE_OPTIONS.find((o) => o.value === role)?.description}</p>
        <p className="text-xs text-gray-400">
          If this email already has an account it is simply added to {brandName} with the chosen role (name and password are ignored).
          Otherwise a new account is created with the password above.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} label="Add Member" />
    </ModalShell>
  );
}

function ResetModal({ user, onClose, onDone }: { user: Member; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState(suggestPassword(user.full_name));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setSaving(true); setErr('');
    const res = await fetch(`${MEMBERS_URL}/${user.id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ new_password: password }),
    });
    setSaving(false);
    if (!res.ok) { setErr(await detail(res, 'Failed')); return; }
    Swal.fire({
      icon: 'success', title: 'Password reset',
      html: `<div style="text-align:left"><b>${escapeHtml(user.email)}</b><br>New password: <code>${escapeHtml(password)}</code></div>`,
      confirmButtonColor: '#7c3aed',
    });
    onDone();
  };
  return (
    <ModalShell title={`Reset password — ${user.full_name || user.email}`} onClose={onClose}>
      <div className="p-5 space-y-3">
        <Field label="New password">
          <div className="flex gap-1">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
            <button type="button" onClick={() => setPassword(suggestPassword(user.full_name))} className="px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">↻</button>
            <button type="button" onClick={() => navigator.clipboard?.writeText(password)} className="px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Copy className="h-4 w-4" /></button>
          </div>
        </Field>
        <p className="text-xs text-gray-400">This changes their password for every brand they belong to. They can change it later under Settings → Profile.</p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} label="Reset Password" />
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-4"
        initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function ModalFooter({ onClose, onSave, saving, label }: { onClose: () => void; onSave: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium disabled:opacity-50">
        {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}
