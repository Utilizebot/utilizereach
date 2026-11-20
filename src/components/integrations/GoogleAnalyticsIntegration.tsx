/**
 * Google Analytics 4 - Settings > Integrations panel.
 *
 * Per brand: connect a Google account (OAuth, read-only Analytics scope),
 * pick the GA4 property, choose which utm_source counts as "your outreach
 * emails" and whether the Dashboard shows the live card.
 *
 * States: not configured on the server / not connected / reconnect required /
 * connected. Handles the OAuth round trip: ?ga=confirm#ga_ticket=<ticket>
 * (redeemed with POST /connect, so only the admin who started the sign-in can
 * finish it) or ?ga_error=<code>. The Google refresh token is never readable
 * in the browser: the ticket is encrypted by the server.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  LayoutDashboard,
  Loader2,
  Mail,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Unplug,
  UserRound,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import { IntegrationCard, StatusPill, type IntegrationPanelProps } from './IntegrationCard';
import {
  GA_API_PATH,
  GA_DOCS_PATH,
  GaApiError,
  confirmGaConnection,
  disconnectGa,
  gaErrorMessage,
  getGaAuthUrl,
  getGaStatus,
  isAbortError,
  listGaProperties,
  updateGaSettings,
  type GaProperty,
  type GaSettingsUpdate,
  type GaStatus,
} from '../../lib/googleAnalytics';

const PROPERTY_ID_RE = /^[0-9]{1,20}$/;
const HIGHLIGHT_MAX = 100;
/** Show the property search box once the list gets longer than this. */
const SEARCH_THRESHOLD = 6;

interface FormState {
  property_id: string;
  property_name: string;
  highlight_source: string;
  show_on_dashboard: boolean;
}

interface Notice {
  tone: 'success' | 'error' | 'info';
  text: string;
}

function formFromStatus(s: GaStatus): FormState {
  return {
    property_id: s.property_id || '',
    property_name: s.property_name || '',
    highlight_source: s.highlight_source || '',
    show_on_dashboard: s.show_on_dashboard,
  };
}

function buildPatch(status: GaStatus | null, form: FormState | null): GaSettingsUpdate {
  if (!status || !form) return {};
  const patch: GaSettingsUpdate = {};
  if (form.property_id && form.property_id !== (status.property_id || '')) {
    patch.property_id = form.property_id;
    if (form.property_name) patch.property_name = form.property_name;
  }
  const highlight = form.highlight_source.trim();
  if (highlight !== (status.highlight_source || '')) patch.highlight_source = highlight;
  if (form.show_on_dashboard !== status.show_on_dashboard) patch.show_on_dashboard = form.show_on_dashboard;
  return patch;
}

function validate(form: FormState): string | null {
  if (form.property_id && !PROPERTY_ID_RE.test(form.property_id)) {
    return 'That property ID does not look right. Pick a property from the list.';
  }
  if (form.highlight_source.trim().length > HIGHLIGHT_MAX) {
    return `The utm_source can be at most ${HIGHLIGHT_MAX} characters.`;
  }
  return null;
}

/**
 * The one-time connect ticket Google's redirect left in this page's URL
 * (?ga=confirm#ga_ticket=...). null: not such a return; '': ticket missing.
 * Read once, before the URL is cleaned up.
 */
function readConnectTicket(): string | null {
  if (new URLSearchParams(window.location.search).get('ga') !== 'confirm') return null;
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('ga_ticket') || '';
}

function errorText(e: unknown, fallback: string): { code: string | null; message: string } {
  const code = e instanceof GaApiError ? e.code : null;
  const message = e instanceof Error && e.message ? e.message : gaErrorMessage(code, fallback);
  return { code, message };
}

export function GoogleAnalyticsIntegration({ meta, delay }: IntegrationPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectTicket] = useState(readConnectTicket);
  const confirmStarted = useRef(false);

  const [status, setStatus] = useState<GaStatus | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [properties, setProperties] = useState<GaProperty[] | null>(null);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState<{ code: string | null; message: string } | null>(null);
  const [query, setQuery] = useState('');

  const applyStatus = useCallback((s: GaStatus) => {
    setStatus(s);
    setForm(formFromStatus(s));
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadError('');
    try {
      applyStatus(await getGaStatus());
    } catch (e) {
      setLoadError(errorText(e, 'Could not load Google Analytics status').message);
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    // Back from Google with a ticket: the confirm step below loads the status.
    if (connectTicket !== null) return;
    void loadStatus();
  }, [loadStatus, connectTicket]);

  // Back from Google (?ga=confirm#ga_ticket=...): save the connection as the
  // signed-in admin. Runs once; the URL is cleaned up by the effect below.
  useEffect(() => {
    if (connectTicket === null || confirmStarted.current) return;
    confirmStarted.current = true;
    void (async () => {
      if (!connectTicket) {
        setNotice({ tone: 'error', text: gaErrorMessage('invalid_state') });
        await loadStatus();
        return;
      }
      setNotice({ tone: 'info', text: 'Finishing the Google Analytics connection...' });
      try {
        applyStatus(await confirmGaConnection(connectTicket));
        setNotice(null);
        setJustConnected(true);
        setLoading(false);
      } catch (e) {
        setNotice({ tone: 'error', text: errorText(e, 'Could not finish connecting Google Analytics').message });
        setJustConnected(false);
        await loadStatus();
      }
    })();
  }, [connectTicket, applyStatus, loadStatus]);

  // OAuth round trip: ?ga=confirm#ga_ticket / ?ga_error=<code> (and the older
  // ?ga=connected). Show a message, then strip the params - and the ticket in
  // the fragment - so a refresh or the history never repeats it.
  useEffect(() => {
    const ok = searchParams.get('ga');
    const err = searchParams.get('ga_error');
    if (!ok && !err) return;
    if (err) {
      setNotice({ tone: 'error', text: gaErrorMessage(err) });
      setJustConnected(false);
    } else if (ok === 'connected') {
      setJustConnected(true);
      setNotice(null);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('ga');
    next.delete('ga_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Success notices fade after a while; errors stay until the next action.
  useEffect(() => {
    if (notice?.tone !== 'success') return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const state = status?.status ?? 'not_connected';
  const isConnected = state === 'connected';
  const canManage = !!status?.can_manage;
  const accountEmail = status?.account_email ?? null;

  const loadProperties = useCallback(
    async (signal?: AbortSignal) => {
      setPropsLoading(true);
      setPropsError(null);
      try {
        const list = await listGaProperties(signal);
        if (signal?.aborted) return;
        setProperties(list);
      } catch (e) {
        if (isAbortError(e)) return;
        const err = errorText(e, 'Could not load your Google Analytics properties');
        setPropsError(err);
        if (err.code === 'reconnect_required' || err.code === 'not_connected') void loadStatus();
      } finally {
        if (!signal?.aborted) setPropsLoading(false);
      }
    },
    [loadStatus]
  );

  // Load the property list once connected (and again if the Google account changes).
  useEffect(() => {
    if (!isConnected || !canManage) return;
    const ctl = new AbortController();
    void loadProperties(ctl.signal);
    return () => ctl.abort();
  }, [isConnected, canManage, accountEmail, loadProperties]);

  const patch = useMemo(() => buildPatch(status, form), [status, form]);
  const dirty = Object.keys(patch).length > 0;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (properties || []).filter(
      (p) =>
        !q ||
        p.display_name.toLowerCase().includes(q) ||
        p.account_name.toLowerCase().includes(q) ||
        p.property_id.includes(q)
    );
    const groups = new Map<string, GaProperty[]>();
    for (const p of list) {
      const key = p.account_name || 'Google Analytics account';
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries());
  }, [properties, query]);

  const connect = async () => {
    setConnecting(true);
    setNotice(null);
    try {
      const url = new URL(await getGaAuthUrl());
      if (url.protocol !== 'https:') throw new Error('The server returned an unexpected sign-in address.');
      window.location.assign(url.href);
      // Keep the spinner until the browser leaves the page.
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e, 'Could not start the Google sign-in').message });
      setConnecting(false);
    }
  };

  const save = async () => {
    if (!status || !form || !dirty) return;
    const invalid = validate(form);
    if (invalid) {
      setNotice({ tone: 'error', text: invalid });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const s = await updateGaSettings(patch);
      applyStatus(s);
      setJustConnected(false);
      const name = s.property_name || (s.property_id ? `property ${s.property_id}` : '');
      setNotice({
        tone: 'success',
        text:
          s.property_id && s.show_on_dashboard
            ? `Saved. Your dashboard now shows live website stats for ${name}.`
            : 'Google Analytics settings saved.',
      });
    } catch (e) {
      const err = errorText(e, 'Could not save Google Analytics settings');
      setNotice({ tone: 'error', text: err.message });
      if (err.code === 'reconnect_required') void loadStatus();
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGa();
      setConfirmOpen(false);
      setProperties(null);
      setQuery('');
      setJustConnected(false);
      await loadStatus();
      setNotice({
        tone: 'success',
        text: 'Google Analytics disconnected from this brand.',
      });
    } catch (e) {
      setConfirmOpen(false);
      setNotice({ tone: 'error', text: errorText(e, 'Could not disconnect Google Analytics').message });
    } finally {
      setDisconnecting(false);
    }
  };

  // ---------------------------------------------------------------- status pill
  let pill: React.ReactNode = null;
  if (status) {
    if (!status.configured && state !== 'connected') pill = <StatusPill tone="gray">Not available</StatusPill>;
    else if (state === 'reconnect_required') pill = <StatusPill tone="amber">Reconnect needed</StatusPill>;
    else if (state === 'connected')
      pill = status.property_id ? (
        <StatusPill tone="green">Connected</StatusPill>
      ) : (
        <StatusPill tone="amber">Choose a property</StatusPill>
      );
    else pill = <StatusPill tone="gray">Not connected</StatusPill>;
  }

  // ---------------------------------------------------------------- body
  let body: React.ReactNode;
  if (loading) {
    body = <LoadingSkeleton />;
  } else if (loadError || !status || !form) {
    body = (
      <div className="text-center py-6">
        <XCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Could not load Google Analytics</p>
        <p className="text-sm text-gray-500 mt-1 mb-4">{loadError || 'Unexpected response from the server.'}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadStatus();
          }}
          className="btn-secondary !py-2 !px-4 text-sm inline-flex items-center gap-2"
        >
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    );
  } else if (!status.configured && state !== 'connected') {
    body = <NotConfigured redirectUri={status.redirect_uri} />;
  } else if (!canManage) {
    body = (
      <div className="flex items-start gap-3 rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
        <ShieldCheck className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <p>Only brand admins can change this integration. Ask an admin of this brand to set it up.</p>
      </div>
    );
  } else if (state === 'not_connected') {
    body = <NotConnected connecting={connecting} onConnect={connect} redirectUri={status.redirect_uri} />;
  } else {
    body = (
      <div className="space-y-6">
        {state === 'reconnect_required' && (
          <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900">Google access needs to be renewed</p>
              <p className="text-sm text-amber-800 mt-0.5">
                {gaErrorMessage('reconnect_required')} Your property and settings are kept.
              </p>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              className="btn-primary !py-2 !px-4 text-sm inline-flex items-center justify-center gap-2 flex-shrink-0"
            >
              {connecting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Reconnect
            </button>
          </div>
        )}

        {justConnected && isConnected && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 flex items-start gap-3"
          >
            <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-emerald-900">Google Analytics connected</p>
              <p className="text-emerald-800 mt-0.5">
                {status.property_id
                  ? 'You are all set. Adjust the settings below any time.'
                  : 'One more step: choose the GA4 property for this brand below, then save.'}
              </p>
            </div>
          </motion.div>
        )}

        {/* Connected account */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white font-bold shadow-sm flex-shrink-0">
            {accountEmail ? accountEmail.charAt(0).toUpperCase() : <UserRound size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Google account</p>
            <p className="text-sm font-semibold text-gray-900 truncate" title={accountEmail || undefined}>
              {accountEmail || 'Connected account'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Read-only access to Google Analytics</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isConnected && (
              <button
                type="button"
                onClick={connect}
                disabled={connecting}
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {connecting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Switch account
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="px-3 py-2 rounded-lg text-sm font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 shadow-sm inline-flex items-center gap-1.5"
            >
              <Unplug size={15} /> Disconnect
            </button>
          </div>
        </div>

        {status.last_error && state === 'connected' && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <b>Last issue:</b> {status.last_error}
            </span>
          </div>
        )}

        {/* 1. Property */}
        <SettingsBlock
          step={1}
          title="GA4 property"
          subtitle="The Google Analytics property that tracks this brand's website."
        >
          {!isConnected ? (
            <p className="text-sm text-gray-500">
              {status.property_name || status.property_id
                ? `Saved: ${status.property_name || 'Property'}${status.property_id ? ` (ID ${status.property_id})` : ''}. Reconnect to change it.`
                : 'Reconnect to choose a property.'}
            </p>
          ) : propsLoading && !properties ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : propsError ? (
            <PropertiesError error={propsError} onRetry={() => void loadProperties()} />
          ) : properties && properties.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center">
              <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-800">No GA4 properties found</p>
              <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                {accountEmail ? <b>{accountEmail}</b> : 'This Google account'} cannot see any Google Analytics 4
                property. Give it at least Viewer access to the property in Google Analytics, or switch to another
                account.
              </p>
              <button
                type="button"
                onClick={() => void loadProperties()}
                className="mt-3 text-sm font-medium text-blue-700 hover:text-blue-800 inline-flex items-center gap-1.5"
              >
                <RefreshCw size={14} /> Check again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                {(properties?.length || 0) > SEARCH_THRESHOLD && (
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search properties or accounts"
                      aria-label="Search Google Analytics properties"
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-gray-500 sm:ml-auto">
                  <span>
                    {properties?.length || 0} {properties?.length === 1 ? 'property' : 'properties'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadProperties()}
                    disabled={propsLoading}
                    className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={propsLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>
              </div>

              {form.property_id &&
                properties &&
                !properties.some((p) => p.property_id === form.property_id) && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>
                      The saved property {form.property_name ? <b>{form.property_name}</b> : null} (ID{' '}
                      {form.property_id}) is not visible to this Google account any more. Pick another one.
                    </span>
                  </div>
                )}

              <div
                role="radiogroup"
                aria-label="Google Analytics property"
                className="max-h-80 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100"
              >
                {filteredGroups.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500 text-center">No property matches "{query.trim()}".</p>
                ) : (
                  filteredGroups.map(([account, list]) => (
                    <div key={account} className="p-2">
                      <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate">
                        {account}
                      </p>
                      <div className="space-y-1">
                        {list.map((p) => {
                          const selected = form.property_id === p.property_id;
                          const isSaved = status.property_id === p.property_id;
                          return (
                            <label
                              key={p.property_id}
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                                selected
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                  : 'border-transparent hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name="ga-property"
                                value={p.property_id}
                                checked={selected}
                                onChange={() =>
                                  setForm((f) =>
                                    f ? { ...f, property_id: p.property_id, property_name: p.display_name } : f
                                  )
                                }
                                className="h-4 w-4 accent-blue-600 flex-shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate" title={p.display_name}>
                                  {p.display_name}
                                </p>
                                <p className="text-xs text-gray-500 font-mono">ID {p.property_id}</p>
                              </div>
                              {isSaved && (
                                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                  In use
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </SettingsBlock>

        {/* 2. Outreach source */}
        <SettingsBlock
          step={2}
          title="Outreach traffic"
          subtitle="How the dashboard recognises visits that came from your outreach emails."
        >
          <label htmlFor="ga-highlight-source" className="block text-sm font-semibold text-gray-700 mb-1">
            utm_source to highlight
          </label>
          <div className="relative max-w-md">
            <Megaphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              id="ga-highlight-source"
              type="text"
              value={form.highlight_source}
              maxLength={HIGHLIGHT_MAX}
              onChange={(e) => setForm((f) => (f ? { ...f, highlight_source: e.target.value } : f))}
              placeholder={status.default_highlight_source || 'e.g. outreach'}
              autoComplete="off"
              spellCheck={false}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            Visits from your outreach emails carry this utm_source. Links to your website in outreach emails are
            tagged automatically, with the sender persona as utm_term. Leave empty to use the brand&rsquo;s
            default
            {status.default_highlight_source ? (
              <>
                {' '}
                (<code className="font-mono">{status.default_highlight_source}</code>)
              </>
            ) : null}
            .
          </p>
        </SettingsBlock>

        {/* 3. Dashboard */}
        <SettingsBlock
          step={3}
          title="Dashboard"
          subtitle="On: everyone in this brand who can view analytics sees it. Off: hidden, and only brand admins can load the data."
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.show_on_dashboard}
              aria-labelledby="ga-show-on-dashboard-label"
              onClick={() => setForm((f) => (f ? { ...f, show_on_dashboard: !f.show_on_dashboard } : f))}
              className={`relative h-6 w-11 rounded-full transition-colors flex-none mt-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                form.show_on_dashboard ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  form.show_on_dashboard ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
            <div className="text-sm">
              <p id="ga-show-on-dashboard-label" className="font-semibold text-gray-900">
                Show &ldquo;Website live&rdquo; on the dashboard
              </p>
              <p className="text-gray-600 mt-0.5">
                Active users in the last 30 minutes, minute by minute, with their top pages, countries and devices,
                plus visits from your email campaigns.
              </p>
            </div>
          </div>
        </SettingsBlock>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 pt-2">
          {status.property_id && status.show_on_dashboard && isConnected && !dirty ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              <LayoutDashboard size={16} /> View on dashboard
            </Link>
          ) : (
            <span className="text-xs text-gray-500">{dirty ? 'You have unsaved changes.' : ''}</span>
          )}
          <div className="flex gap-3 sm:ml-auto">
            <button
              type="button"
              onClick={() => setForm(formFromStatus(status))}
              disabled={!dirty || saving}
              className="btn-secondary !py-2.5 !px-4 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw size={16} /> Reset
            </button>
            <motion.button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="btn-primary !py-2.5 !px-6 text-sm inline-flex items-center gap-2"
              whileHover={dirty && !saving ? { scale: 1.02 } : undefined}
              whileTap={dirty && !saving ? { scale: 0.98 } : undefined}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving...' : 'Save changes'}
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <IntegrationCard meta={meta} status={pill} delay={delay}>
        <AnimatePresence>
          {notice && (
            <motion.div
              key={notice.text}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`mb-5 rounded-xl border p-4 flex items-start gap-3 ${
                notice.tone === 'success'
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : notice.tone === 'error'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              {notice.tone === 'success' ? (
                <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
              ) : notice.tone === 'error' ? (
                <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
              ) : (
                <Info className="h-5 w-5 text-blue-600 flex-shrink-0" />
              )}
              <p className="text-sm flex-1">{notice.text}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss message"
                className="opacity-60 hover:opacity-100"
              >
                <XCircle size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {body}
      </IntegrationCard>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Disconnect Google Analytics?"
        message={
          <>
            <p>
              This removes the Google Analytics connection
              {accountEmail ? (
                <>
                  {' '}
                  (<b className="text-gray-900">{accountEmail}</b>)
                </>
              ) : null}{' '}
              from this brand and hides the &ldquo;Website live&rdquo; card on its dashboard.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Google access is revoked too, unless that Google account is still used here for something else, such
              as a connected mailbox. Your Analytics data is not affected.
            </p>
          </>
        }
        confirmLabel="Disconnect"
        busy={disconnecting}
        onConfirm={disconnect}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SettingsBlock({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
          {step}
        </span>
        <div>
          <h4 className="text-sm font-bold text-gray-900">{title}</h4>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-1/3 rounded bg-gray-100 animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-gray-100 animate-pulse" />
      <div className="h-10 w-48 rounded-xl bg-gray-100 animate-pulse mt-4" />
    </div>
  );
}

const BENEFITS = [
  {
    icon: Activity,
    gradient: 'from-emerald-500 to-teal-500',
    title: 'Live visitors',
    text: 'Who was on your website in the last 30 minutes, minute by minute.',
  },
  {
    icon: Mail,
    gradient: 'from-purple-500 to-pink-500',
    title: 'Email-driven visits',
    text: 'Sessions and key events per campaign and sender persona.',
  },
  {
    icon: ShieldCheck,
    gradient: 'from-blue-500 to-indigo-600',
    title: 'Read-only',
    text: 'UtilizeReach can only read reports. It never changes your Analytics.',
  },
];

function NotConnected({
  connecting,
  onConnect,
  redirectUri,
}: {
  connecting: boolean;
  onConnect: () => void;
  redirectUri: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {BENEFITS.map(({ icon: Icon, gradient, title, text }) => (
          <div key={title} className="rounded-xl border border-gray-200 p-4 bg-gradient-to-br from-white to-gray-50">
            <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm mb-3`}>
              <Icon className="text-white" size={18} />
            </div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-600 mt-1">{text}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <motion.button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="btn-primary !py-2.5 inline-flex items-center justify-center gap-2"
          whileHover={connecting ? undefined : { scale: 1.02 }}
          whileTap={connecting ? undefined : { scale: 0.98 }}
        >
          {connecting ? <Loader2 size={18} className="animate-spin" /> : <BarChart3 size={18} />}
          {connecting ? 'Opening Google...' : 'Connect Google Analytics'}
        </motion.button>
        <p className="text-xs text-gray-500 max-w-md">
          You will sign in with Google and allow read-only access to Analytics for this brand. You can disconnect
          at any time.
        </p>
      </div>

      <SetupChecklist redirectUri={redirectUri} />
    </div>
  );
}

function NotConfigured({ redirectUri }: { redirectUri: string | null }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
        <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-gray-700">
          <p className="font-semibold text-gray-900">Google sign-in is not set up on this server yet</p>
          <p className="mt-1">
            A server admin needs to configure the Google OAuth client (the same one used to connect Gmail) before
            any brand can connect Google Analytics. Setup guide:{' '}
            <code className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-xs">{GA_DOCS_PATH}</code>
          </p>
        </div>
      </div>
      <SetupChecklist defaultOpen redirectUri={redirectUri} />
    </div>
  );
}

function SetupChecklist({
  defaultOpen = false,
  redirectUri: serverRedirectUri,
}: {
  defaultOpen?: boolean;
  redirectUri: string | null;
}) {
  // The server knows its public URL; fall back to this page's origin.
  const redirectUri = serverRedirectUri || `${window.location.origin}${GA_API_PATH}/callback`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (e.g. insecure context) - the URI is still selectable */
    }
  };

  return (
    <details open={defaultOpen} className="group rounded-xl border border-gray-200 bg-white">
      <summary className="flex items-center gap-2 cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-700 list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown size={16} className="text-gray-400 transition-transform -rotate-90 group-open:rotate-0" />
        Server admin setup (Google Cloud Console)
      </summary>
      <ol className="px-4 pb-4 pt-1 space-y-3 text-sm text-gray-600">
        <SetupStep n={1}>
          Open the Google Cloud project that owns this server&rsquo;s OAuth client (the one in{' '}
          <code className="text-xs">GOOGLE_CLIENT_ID</code> / <code className="text-xs">GOOGLE_CLIENT_SECRET</code>).
        </SetupStep>
        <SetupStep n={2}>
          Under <b>APIs &amp; Services &gt; Library</b>, enable <b>Google Analytics Data API</b> and{' '}
          <b>Google Analytics Admin API</b>.
        </SetupStep>
        <SetupStep n={3}>
          Add this <b>Authorized redirect URI</b> to the OAuth client
          {serverRedirectUri ? ':' : ' (if the app is served from this address):'}
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-800 select-all">
              {redirectUri}
            </code>
            <button
              type="button"
              onClick={copy}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 flex-shrink-0"
              aria-label="Copy redirect URI"
              title="Copy"
            >
              {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
            </button>
          </div>
        </SetupStep>
        <SetupStep n={4}>
          If the OAuth consent screen is in <b>Testing</b> mode, add the Google accounts that will connect as test
          users. Full guide: <code className="text-xs">{GA_DOCS_PATH}</code>
          <a
            href="https://console.cloud.google.com/apis/library"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1 text-blue-700 hover:text-blue-800 font-medium"
          >
            Open Google Cloud Console <ExternalLink size={12} />
          </a>
        </SetupStep>
      </ol>
    </details>
  );
}

function SetupStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="h-5 w-5 rounded-full bg-orange-100 text-orange-700 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function PropertiesError({
  error,
  onRetry,
}: {
  error: { code: string | null; message: string };
  onRetry: () => void;
}) {
  const apiDisabled = error.code === 'api_disabled';
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-semibold text-red-900">
          {apiDisabled ? 'Google Analytics APIs are not enabled' : 'Could not load your properties'}
        </p>
        <p className="text-red-800 mt-0.5">{error.message}</p>
        {apiDisabled && (
          <p className="text-red-700 text-xs mt-2">
            After enabling them it can take a few minutes before Google accepts requests.
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800"
        >
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    </div>
  );
}
