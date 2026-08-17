import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import {
  Users, UserPlus, KeyRound, Trash2, ShieldCheck, Shield, X, Loader2,
  CheckCircle2, XCircle, Copy,
} from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface User {
  id: string; email: string; full_name: string; role: string;
  is_active: boolean; last_login?: string | null; created_at?: string;
}

function suggestPassword(name: string) {
  const base = (name || 'User').trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, '') || 'User';
  const cap = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  return `${cap}2026!`;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function UsersSettings() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/users`, { headers: { ...authHeaders() }, cache: 'no-store' });
      if (r.ok) setUsers((await r.json()).users || []);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { if (isAdmin) fetchUsers(); }, [isAdmin]);

  const toggleActive = async (u: User) => {
    await fetch(`${API_BASE}/api/auth/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    fetchUsers();
  };
  const toggleRole = async (u: User) => {
    const next = u.role === 'admin' ? 'sales_rep' : 'admin';
    const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ role: next }),
    });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Cannot change role', text: (await res.json()).detail || '' });
    fetchUsers();
  };
  const removeUser = async (u: User) => {
    const c = await Swal.fire({
      title: `Delete ${u.full_name || u.email}?`, text: 'They will lose all access immediately.',
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Delete',
    });
    if (!c.isConfirmed) return;
    const res = await fetch(`${API_BASE}/api/auth/users/${u.id}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (!res.ok) Swal.fire({ icon: 'error', title: 'Cannot delete', text: (await res.json()).detail || '' });
    fetchUsers();
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Admins only</p>
        <p className="text-sm text-gray-500 mt-1">You need an admin account to manage users.</p>
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
            <p className="text-sm text-gray-500">Add team members, set roles, reset passwords</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow hover:shadow-lg transition-all">
          <UserPlus className="h-4 w-4" /> Add User
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Last login</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{u.full_name || '—'}</div>
                      <div className="text-sm text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-6 py-3">
                      <button onClick={() => toggleRole(u)} title="Toggle role"
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role === 'admin' ? <ShieldCheck className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                        {u.role === 'admin' ? 'Admin' : 'Member'}
                      </button>
                    </td>
                    <td className="px-6 py-3">
                      <button onClick={() => toggleActive(u)}
                        className={`inline-flex items-center gap-1 text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {u.is_active ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {u.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-500">{fmtDate(u.last_login)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setResetFor(u)} title="Reset password"
                          className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600"><KeyRound className="h-4 w-4" /></button>
                        <button onClick={() => removeUser(u)} title="Delete user"
                          className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">No users yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); fetchUsers(); }} />}
      </AnimatePresence>
      <AnimatePresence>
        {resetFor && <ResetModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>{children}</div>;
}

function AddUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('sales_rep');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!email.includes('@')) { setErr('Enter a valid email'); return; }
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setSaving(true); setErr('');
    const res = await fetch(`${API_BASE}/api/auth/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ email, full_name: name, role, password }),
    });
    setSaving(false);
    if (!res.ok) { setErr((await res.json()).detail || 'Failed to create user'); return; }
    Swal.fire({
      icon: 'success', title: 'User created',
      html: `<div style="text-align:left"><b>${email}</b><br>Password: <code>${password}</code><br><span style="font-size:12px;color:#888">Share it securely; they can change it under Profile.</span></div>`,
      confirmButtonColor: '#7c3aed',
    });
    onDone();
  };

  return (
    <ModalShell title="Add User" onClose={onClose}>
      <div className="p-5 space-y-4">
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" /></Field>
        <Field label="Full name"><input value={name} onChange={(e) => { setName(e.target.value); if (!password) setPassword(suggestPassword(e.target.value)); }}
          placeholder="e.g. Syeefa Wadhiah" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="sales_rep">Member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Password">
            <div className="flex gap-1">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm" />
              <button type="button" onClick={() => setPassword(suggestPassword(name))} title="Suggest" className="px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">↻</button>
            </div>
          </Field>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} label="Create User" />
    </ModalShell>
  );
}

function ResetModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState(suggestPassword(user.full_name));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    setSaving(true); setErr('');
    const res = await fetch(`${API_BASE}/api/auth/users/${user.id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ new_password: password }),
    });
    setSaving(false);
    if (!res.ok) { setErr((await res.json()).detail || 'Failed'); return; }
    Swal.fire({
      icon: 'success', title: 'Password reset',
      html: `<div style="text-align:left"><b>${user.email}</b><br>New password: <code>${password}</code></div>`,
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
        <p className="text-xs text-gray-400">The user can change it later under Settings → Profile.</p>
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
