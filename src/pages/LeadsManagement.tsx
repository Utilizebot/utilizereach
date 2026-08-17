import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ColumnMappingModal } from '../components/ColumnMappingModal';
import { LeadTimelineModal } from '../components/LeadTimelineModal';
import Swal from 'sweetalert2';
import { useConfigContext } from '../context/ConfigContext';
import {
  Users,
  Upload,
  Send,
  RefreshCw,
  XCircle,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Loader,
  Download,
  Ban,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Mail,
  UserPlus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Layers
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Lead {
  id: string;
  email: string;
  name: string;
  company: string;
  title: string;
  phone: string;
  industry: string;
  location: string;
  status: string;
  segment?: string | null;
  created_at: string;
  source?: string;
}

interface Segment {
  key: string;
  label: string;
  description?: string | null;
  color?: string;
  is_active?: boolean;
  lead_count?: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  total: number;
  error_details?: string[];
  column_mapping?: {
    found: Record<string, string>;
    unmatched_columns: string[];
  };
  warnings?: string[];
}

interface Exclusion {
  id: string;
  email: string;
  reason: string | null;
  created_at: string;
}

interface EmailAccount {
  id: string;
  email: string;
  sender_name: string;
  status: string;
}

export function LeadsManagement() {
  const { config } = useConfigContext();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dbTotal, setDbTotal] = useState<number | undefined>(undefined);
  const [dbStats, setDbStats] = useState<{ new_leads: number; contacted_leads: number } | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File upload states
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Campaign states
  const [launchingCampaign, setLaunchingCampaign] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);

  // Exclusion states
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [newExclusion, setNewExclusion] = useState('');
  const [addingExclusion, setAddingExclusion] = useState(false);

  // Column mapping states
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);

  // Delete states
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Add Lead states
  const [addingLead, setAddingLead] = useState(false);
  const [timelineEmail, setTimelineEmail] = useState<string | null>(null);

  // Send Email states
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [leadsPerPage] = useState(20);

  // Name sort state
  const [nameSortDir, setNameSortDir] = useState<'asc' | 'desc' | null>(null);

  // Segment states
  const [segments, setSegments] = useState<Segment[]>([]);
  const [unsegmentedCount, setUnsegmentedCount] = useState(0);
  const [activeSegment, setActiveSegment] = useState<string>(''); // '' = all
  const [segMenuOpen, setSegMenuOpen] = useState(false);
  const [segSearch, setSegSearch] = useState('');

  useEffect(() => {
    fetchSegments();
    fetchExclusions();
    fetchEmailAccounts();
  }, []);

  // Re-fetch leads whenever the active segment changes
  useEffect(() => {
    fetchLeads();
    setCurrentPage(1);
    setSelectedLeads(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment]);

  const segmentMeta = (key?: string | null) =>
    segments.find((s) => s.key === key);

  const fetchSegments = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/segments/`, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        const segs = (data.segments || []).slice().sort((a: Segment, b: Segment) =>
          a.label.toLowerCase().localeCompare(b.label.toLowerCase())
        );
        setSegments(segs);
        setUnsegmentedCount(data.unsegmented_count || 0);
      }
    } catch (err) {
      console.error('Failed to fetch segments:', err);
    }
  };

  const addSegment = async () => {
    const { value: label } = await Swal.fire({
      title: 'New segment',
      input: 'text',
      inputLabel: 'Segment name',
      inputPlaceholder: 'e.g. Corporate Investors',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      confirmButtonText: 'Create',
    });
    if (!label || !label.trim()) return;
    try {
      const response = await fetch(`${API_BASE}/api/segments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!response.ok) {
        const e = await response.json().catch(() => ({}));
        throw new Error(e.detail || 'Failed to create segment');
      }
      await fetchSegments();
      Swal.fire({ icon: 'success', title: 'Segment created', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Could not create segment', text: err instanceof Error ? err.message : '' });
    }
  };

  const fetchEmailAccounts = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/email-accounts/`, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setEmailAccounts(data.accounts || []);
      }
    } catch (err) {
      console.error('Failed to fetch email accounts:', err);
    }
  };

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const segParam = activeSegment ? `&segment=${encodeURIComponent(activeSegment)}` : '';
      const response = await fetch(`${API_BASE}/api/leads/?limit=10000${segParam}`, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error('Failed to fetch leads');
      }

      const data = await response.json();
      setLeads(data.leads || []);
      setDbTotal(typeof data.total === 'number' ? data.total : undefined);
      setError(null);

      // True status counts across the whole database (not just the loaded page)
      fetch(`${API_BASE}/api/campaigns/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st && typeof st.new_leads === 'number') {
            setDbStats({ new_leads: st.new_leads, contacted_leads: st.contacted_leads ?? 0 });
          }
        })
        .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const fetchExclusions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/exclusions/`, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setExclusions(data.exclusions || []);
      }
    } catch (err) {
      console.error('Failed to fetch exclusions:', err);
    }
  };

  const addExclusion = async () => {
    if (!newExclusion || !newExclusion.includes('@')) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid Email',
        text: 'Please enter a valid email address',
        confirmButtonColor: '#dc2626'
      });
      return;
    }

    setAddingExclusion(true);
    try {
      const response = await fetch(`${API_BASE}/api/exclusions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newExclusion.trim(),
          reason: 'Manually excluded from campaigns'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to add exclusion');
      }

      setNewExclusion('');
      await fetchExclusions();

      Swal.fire({
        icon: 'success',
        title: 'Email Excluded',
        text: `${newExclusion} has been added to the exclusion list`,
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Failed to Add Exclusion',
        text: err instanceof Error ? err.message : 'Failed to add exclusion',
        confirmButtonColor: '#dc2626'
      });
    } finally {
      setAddingExclusion(false);
    }
  };

  const removeExclusion = async (id: string) => {
    const result = await Swal.fire({
      title: 'Remove Exclusion?',
      text: 'This email will be able to receive campaign emails again',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, remove it'
    });

    if (!result.isConfirmed) return;

    try {
      const response = await fetch(`${API_BASE}/api/exclusions/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to remove exclusion');
      }

      await fetchExclusions();

      Swal.fire({
        icon: 'success',
        title: 'Removed',
        text: 'Email removed from exclusion list',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Failed',
        text: err instanceof Error ? err.message : 'Failed to remove exclusion',
        confirmButtonColor: '#dc2626'
      });
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    // Validate file type
    const validTypes = ['.xlsx', '.xls', '.csv'];
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!validTypes.includes(fileExt)) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid File Type',
        text: 'Please upload an Excel (.xlsx, .xls) or CSV (.csv) file',
        confirmButtonColor: '#7c3aed'
      });
      return;
    }

    setUploading(true);
    setImportResult(null);
    setCurrentFile(file);

    try {
      // Step 1: Preview the file to get column mappings
      const formData = new FormData();
      formData.append('file', file);

      const previewResponse = await fetch(`${API_BASE}/api/leads/preview`, {
        method: 'POST',
        body: formData,
      });

      if (!previewResponse.ok) {
        const errorData = await previewResponse.json().catch(() => ({ detail: 'Failed to preview file' }));
        throw new Error(errorData.detail || 'Failed to preview file');
      }

      const preview = await previewResponse.json();
      console.log('Preview:', preview);

      // Step 2: Show mapping modal
      setPreviewData(preview);
      setShowMappingModal(true);
      setUploading(false);

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Upload Failed',
        text: err instanceof Error ? err.message : 'Failed to upload file',
        confirmButtonColor: '#7c3aed'
      });
      setUploading(false);
      setCurrentFile(null);
    }
  };

  const handleConfirmMapping = async (mappings: Record<string, string>) => {
    if (!currentFile) return;

    setShowMappingModal(false);

    // Decide which segment these leads belong to. If a segment tab is active,
    // import straight into it; otherwise ask (existing segment, new, or none).
    let importSegment = activeSegment;
    if (!importSegment) {
      const opts: Record<string, string> = { '': '— No segment —' };
      segments.forEach((s) => { opts[s.key] = s.label; });
      opts['__new__'] = '➕ New segment…';
      const { value: choice } = await Swal.fire({
        title: 'Assign to segment',
        input: 'select',
        inputOptions: opts,
        inputValue: '',
        showCancelButton: true,
        confirmButtonColor: '#7c3aed',
        confirmButtonText: 'Import',
      });
      if (choice === undefined) return; // cancelled
      if (choice === '__new__') {
        const { value: newName } = await Swal.fire({
          title: 'New segment name',
          input: 'text',
          inputPlaceholder: 'e.g. Corporate Investors',
          showCancelButton: true,
          confirmButtonColor: '#7c3aed',
        });
        if (!newName) return;
        importSegment = newName.trim();
      } else {
        importSegment = choice;
      }
    }

    setUploading(true);

    try {
      // Import with custom column mappings
      const formData = new FormData();
      formData.append('file', currentFile);
      formData.append('column_mappings', JSON.stringify(mappings));
      if (importSegment) formData.append('segment', importSegment);

      const url = importSegment
        ? `${API_BASE}/api/leads/import?segment=${encodeURIComponent(importSegment)}`
        : `${API_BASE}/api/leads/import`;
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to import leads' }));
        console.error('Import error:', errorData);
        throw new Error(errorData.detail || 'Failed to import leads');
      }

      const result = await response.json();
      console.log('Import result:', result);
      setImportResult(result);

      // Refresh leads list + segment counts (a new segment may have appeared)
      await fetchLeads();
      await fetchSegments();

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Import Failed',
        text: err instanceof Error ? err.message : 'Failed to import leads',
        confirmButtonColor: '#7c3aed'
      });
    } finally {
      setUploading(false);
      setCurrentFile(null);
      setPreviewData(null);
    }
  };

  const handleLaunchCampaign = async () => {
    // Get company info from config
    const companyName = config?.company?.name || 'Your Company';
    const companyTagline = config?.company?.tagline || 'products and services';

    // Get active email account names
    const activeAccounts = emailAccounts.filter(acc => acc.status === 'active');
    const senderNames = activeAccounts.length > 0
      ? activeAccounts.map(acc => acc.sender_name).join(', ')
      : 'No email accounts connected';

    // Check if there are connected email accounts
    if (activeAccounts.length === 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'No Email Accounts',
        text: 'Please connect at least one Gmail account before launching a campaign.',
        confirmButtonText: 'Go to Email Accounts',
        confirmButtonColor: '#8b5cf6'
      }).then((result) => {
        if (result.isConfirmed) {
          window.location.href = '/email-accounts';
        }
      });
      return;
    }

    const result = await Swal.fire({
      title: 'Launch Email Campaign',
      html: `
        <div class="text-left space-y-4">
          <div class="bg-purple-50 p-4 rounded-lg border border-purple-200 mb-4">
            <p class="font-semibold text-purple-900 mb-2">📧 Campaign Details</p>
            <p class="text-sm text-purple-800">Your AI team will send personalized emails about <strong>${companyName}'s ${companyTagline}</strong></p>
            <p class="text-xs text-purple-700 mt-2">Senders: ${senderNames}</p>
            <p class="text-xs text-purple-700 mt-1">Target: <strong>${activeSegment ? (segmentMeta(activeSegment)?.label || activeSegment) : 'All segments'}</strong></p>
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Maximum Emails to Send</label>
            <input
              id="max-emails"
              type="number"
              value="30"
              min="1"
              max="50"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <p class="text-xs text-gray-500 mt-1">Warmup mode: Max 30-50 emails/day recommended</p>
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Delay Between Emails (seconds)</label>
            <input
              id="delay-seconds"
              type="number"
              value="60"
              min="30"
              max="120"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
            <p class="text-xs text-gray-500 mt-1">Warmup mode: 60-120 seconds (better deliverability)</p>
          </div>

          <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <p class="text-xs text-blue-800">
              <strong>Domain Warmup Mode:</strong> Sending slowly to build reputation.
              Start with 30 emails/day, increase gradually over 2-3 weeks.
            </p>
          </div>

          <div class="bg-amber-50 p-3 rounded-lg border border-amber-200">
            <p class="text-xs text-amber-800">
              ⚠️ <strong>Note:</strong> Once started, the campaign will run in the background.
              Emails will be sent automatically to new leads only.
            </p>
          </div>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Launch Campaign',
      cancelButtonText: 'Cancel',
      width: '600px',
      preConfirm: () => {
        const maxEmails = parseInt((document.getElementById('max-emails') as HTMLInputElement).value);
        const delaySeconds = parseInt((document.getElementById('delay-seconds') as HTMLInputElement).value);

        if (!maxEmails || maxEmails < 1) {
          Swal.showValidationMessage('Please enter a valid number of emails');
          return false;
        }

        if (!delaySeconds || delaySeconds < 30) {
          Swal.showValidationMessage('Delay must be at least 30 seconds for warmup mode');
          return false;
        }

        return { maxEmails, delaySeconds };
      }
    });

    if (!result.isConfirmed || !result.value) return;

    const { maxEmails, delaySeconds } = result.value;
    const estimatedMinutes = Math.ceil((maxEmails * delaySeconds) / 60);

    // Show confirmation with estimated time
    const confirmResult = await Swal.fire({
      title: 'Confirm Launch',
      html: `
        <div class="text-left">
          <p class="mb-3">Ready to launch campaign with these settings:</p>
          <div class="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
            <p>📧 <strong>Max Emails:</strong> ${maxEmails}</p>
            <p>⏱️ <strong>Delay:</strong> ${delaySeconds} seconds</p>
            <p>⌛ <strong>Estimated Duration:</strong> ~${estimatedMinutes} minutes</p>
            <p>👥 <strong>Available Leads:</strong> ${newLeadsCount.toLocaleString()}</p>
            ${exclusions.length > 0 ? `<p>🚫 <strong>Excluded:</strong> ${exclusions.length} emails</p>` : ''}
          </div>
          <p class="text-sm text-gray-600 mt-4">Campaign will start immediately after confirmation.</p>
        </div>
      `,
      icon: 'info',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Start Now',
      cancelButtonText: 'Go Back'
    });

    if (!confirmResult.isConfirmed) return;

    setLaunchingCampaign(true);

    try {
      const response = await fetch(`${API_BASE}/api/campaigns/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_emails: maxEmails,
          delay_seconds: delaySeconds,
          ...(activeSegment ? { segment: activeSegment } : {})
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start campaign');
      }

      const campaignResult = await response.json();

      await Swal.fire({
        icon: 'success',
        title: 'Campaign Started!',
        html: `<p>${campaignResult.leads_count || 0} emails queued for sending.</p>`,
        timer: 3000,
        showConfirmButton: false
      });

      // Refresh leads
      await fetchLeads();

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Campaign Failed',
        text: err instanceof Error ? err.message : 'Failed to launch campaign',
        confirmButtonColor: '#dc2626'
      });
    } finally {
      setLaunchingCampaign(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/leads/template`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads_import_template.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download template:', err);
      Swal.fire({
        icon: 'error',
        title: 'Download Failed',
        text: 'Failed to download template',
        confirmButtonColor: '#7c3aed'
      });
    }
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadId)) {
        newSet.delete(leadId);
      } else {
        newSet.add(leadId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLeads.size === leads.filter(l => l.source === 'scraped').length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.filter(l => l.source === 'scraped').map(l => l.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.size === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'No Selection',
        text: 'Please select leads to delete',
        confirmButtonColor: '#7c3aed'
      });
      return;
    }

    const result = await Swal.fire({
      title: 'Delete Selected Leads?',
      text: `Delete ${selectedLeads.size} selected lead(s)? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete them'
    });

    if (!result.isConfirmed) return;

    setDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/api/leads/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(selectedLeads))
      });

      if (!response.ok) {
        throw new Error('Failed to delete leads');
      }

      const deleteResult = await response.json();

      await Swal.fire({
        icon: 'success',
        title: 'Deleted',
        text: `Successfully deleted ${deleteResult.deleted} lead(s)`,
        timer: 2000,
        showConfirmButton: false
      });

      setSelectedLeads(new Set());
      await fetchLeads();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Delete Failed',
        text: err instanceof Error ? err.message : 'Failed to delete leads',
        confirmButtonColor: '#dc2626'
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSingle = async (leadId: string, leadEmail: string) => {
    const result = await Swal.fire({
      title: 'Delete Lead?',
      text: `Delete ${leadEmail}? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete it'
    });

    if (!result.isConfirmed) return;

    try {
      const response = await fetch(`${API_BASE}/api/leads/${leadId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete lead');
      }

      await Swal.fire({
        icon: 'success',
        title: 'Deleted',
        text: 'Lead successfully deleted',
        timer: 1500,
        showConfirmButton: false
      });

      await fetchLeads();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Delete Failed',
        text: err instanceof Error ? err.message : 'Failed to delete lead',
        confirmButtonColor: '#dc2626'
      });
    }
  };

  // Add single lead
  const handleAddLead = async () => {
    const { value: formValues } = await Swal.fire({
      title: 'Add New Lead',
      html: `
        <div class="text-left space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Email <span class="text-red-500">*</span></label>
            <input id="swal-email" type="email" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="lead@company.com" required>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Name</label>
              <input id="swal-name" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="John Doe">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Company</label>
              <input id="swal-company" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="Acme Inc">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Job Title</label>
              <input id="swal-title" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="CEO">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
              <input id="swal-phone" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="+1234567890">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Industry</label>
              <input id="swal-industry" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="Technology">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">Location</label>
              <input id="swal-location" type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" placeholder="New York, USA">
            </div>
          </div>
        </div>
      `,
      width: 500,
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Add Lead',
      cancelButtonText: 'Cancel',
      focusConfirm: false,
      preConfirm: () => {
        const email = (document.getElementById('swal-email') as HTMLInputElement).value.trim();
        const name = (document.getElementById('swal-name') as HTMLInputElement).value.trim();
        const company = (document.getElementById('swal-company') as HTMLInputElement).value.trim();
        const title = (document.getElementById('swal-title') as HTMLInputElement).value.trim();
        const phone = (document.getElementById('swal-phone') as HTMLInputElement).value.trim();
        const industry = (document.getElementById('swal-industry') as HTMLInputElement).value.trim();
        const location = (document.getElementById('swal-location') as HTMLInputElement).value.trim();

        if (!email || !email.includes('@')) {
          Swal.showValidationMessage('Please enter a valid email address');
          return false;
        }

        return { email, name, company, title, phone, industry, location };
      }
    });

    if (!formValues) return;

    setAddingLead(true);
    try {
      const response = await fetch(`${API_BASE}/api/leads/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formValues.email,
          name: formValues.name || null,
          company: formValues.company || null,
          title: formValues.title || null,
          phone: formValues.phone || null,
          industry: formValues.industry || null,
          location: formValues.location || null,
          source: 'manual'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to add lead');
      }

      await Swal.fire({
        icon: 'success',
        title: 'Lead Added',
        text: `${formValues.email} has been added successfully`,
        timer: 2000,
        showConfirmButton: false
      });

      await fetchLeads();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Failed to Add Lead',
        text: err instanceof Error ? err.message : 'Something went wrong',
        confirmButtonColor: '#dc2626'
      });
    } finally {
      setAddingLead(false);
    }
  };

  // Send email to single lead
  const handleSendEmailToLead = async (lead: Lead) => {
    // Check if email accounts exist
    const activeAccounts = emailAccounts.filter(acc => acc.status === 'active');
    if (activeAccounts.length === 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'No Email Accounts',
        text: 'Please connect at least one Gmail account first.',
        confirmButtonText: 'Go to Email Accounts',
        confirmButtonColor: '#8b5cf6'
      }).then((result) => {
        if (result.isConfirmed) {
          window.location.href = '/email-accounts';
        }
      });
      return;
    }

    const companyName = config?.company?.name || 'Your Company';

    const result = await Swal.fire({
      title: 'Send Email',
      html: `
        <div class="text-left space-y-4">
          <div class="bg-purple-50 p-4 rounded-lg border border-purple-200">
            <p class="text-sm text-purple-800">
              <strong>To:</strong> ${lead.email}<br>
              ${lead.name ? `<strong>Name:</strong> ${lead.name}<br>` : ''}
              ${lead.company ? `<strong>Company:</strong> ${lead.company}` : ''}
            </p>
          </div>
          <p class="text-sm text-gray-600">
            AI will generate a personalized email about <strong>${companyName}</strong> and send it from one of your connected accounts.
          </p>
          <div class="text-xs text-gray-500">
            Sender: ${activeAccounts[0].sender_name} (${activeAccounts[0].email})
          </div>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Send Email',
      cancelButtonText: 'Cancel'
    });

    if (!result.isConfirmed) return;

    setSendingEmail(lead.id);
    try {
      const response = await fetch(`${API_BASE}/api/emails/send-to-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          email_account_id: activeAccounts[0].id
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to send email');
      }

      await Swal.fire({
        icon: 'success',
        title: 'Email Sent!',
        html: `<p>Email successfully sent to <strong>${lead.email}</strong></p>`,
        timer: 3000,
        showConfirmButton: false
      });

      // Refresh leads to update status
      await fetchLeads();
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Failed to Send',
        text: err instanceof Error ? err.message : 'Something went wrong',
        confirmButtonColor: '#dc2626'
      });
    } finally {
      setSendingEmail(null);
    }
  };

  const newLeadsCount = dbStats?.new_leads ?? leads.filter(l => l.status === 'new').length;
  const totalLeadsCount = dbTotal ?? leads.length;

  // Shareholders segment detection (for badge logic)
  const activeSegmentLabel = segments.find(s => s.key === activeSegment)?.label ?? '';
  const isShareholdersSeg = activeSegmentLabel.toLowerCase() === 'shareholders';

  // Move named Shareholders leads → Individual segment
  const handleMoveIndvToIndividual = async () => {
    const indvLeads = leads.filter(l => l.name && l.name.trim() !== '');
    if (indvLeads.length === 0) {
      Swal.fire({ icon: 'info', title: 'No Indv leads found', text: 'There are no leads with a name in this segment.', confirmButtonColor: '#7c3aed' });
      return;
    }

    const confirm = await Swal.fire({
      title: 'Move Indv leads?',
      html: `<p>Move <strong>${indvLeads.length.toLocaleString()}</strong> named lead(s) from <strong>Shareholders</strong> to <strong>Individual Shareholders</strong> segment.</p>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#7c3aed',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, move them',
    });
    if (!confirm.isConfirmed) return;

    try {
      // Ensure Individual Shareholders segment exists
      const segRes = await fetch(`${API_BASE}/api/segments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Individual Shareholders' }),
      });
      // 400 = already exists, both are fine
      if (!segRes.ok && segRes.status !== 400) {
        const e = await segRes.json().catch(() => ({}));
        throw new Error(e.detail || 'Failed to create Individual Shareholders segment');
      }

      // Assign leads to Individual Shareholders segment
      const assignRes = await fetch(`${API_BASE}/api/segments/individual_shareholders/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: indvLeads.map(l => l.id) }),
      });
      if (!assignRes.ok) {
        const e = await assignRes.json().catch(() => ({}));
        throw new Error(e.detail || 'Failed to reassign leads');
      }

      const result = await assignRes.json();
      await Swal.fire({
        icon: 'success',
        title: 'Moved!',
        text: `${result.updated} lead(s) moved to Individual segment.`,
        timer: 2500,
        showConfirmButton: false,
      });

      await fetchLeads();
      await fetchSegments();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Move failed', text: err instanceof Error ? err.message : 'Something went wrong', confirmButtonColor: '#dc2626' });
    }
  };

  // Pagination calculations (apply name sort first)
  const sortedLeads = nameSortDir
    ? [...leads].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return nameSortDir === 'asc' ? -1 : 1;
        if (nameA > nameB) return nameSortDir === 'asc' ? 1 : -1;
        return 0;
      })
    : leads;
  const totalPages = Math.ceil(sortedLeads.length / leadsPerPage);
  const startIndex = (currentPage - 1) * leadsPerPage;
  const endIndex = startIndex + leadsPerPage;
  const paginatedLeads = sortedLeads.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="inline-block h-16 w-16 border-4 border-purple-600 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="mt-4 text-gray-600 font-medium">Loading leads...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Failed to Load</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={fetchLeads}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Lead Management
              </h1>
              <p className="text-gray-600 text-sm mt-0.5">
                Import, manage, and send campaigns to your leads
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchLeads}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="font-medium text-sm">Refresh</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Total Leads"
          value={totalLeadsCount.toLocaleString()}
          subtitle="In database"
          icon={Users}
          gradient="from-purple-500 to-purple-600"
          delay={0}
        />

        <StatCard
          title="Ready to Email"
          value={newLeadsCount.toLocaleString()}
          subtitle="Not yet contacted"
          icon={Send}
          gradient="from-emerald-500 to-emerald-600"
          delay={0.1}
        />

        <StatCard
          title="Contacted"
          value={leads.filter(l => l.status !== 'new').length}
          subtitle="Already emailed"
          icon={CheckCircle}
          gradient="from-blue-500 to-blue-600"
          delay={0.2}
        />
      </div>

      {/* Import Section */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center">
                <Upload className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Import Leads</h2>
                <p className="text-sm text-gray-600">Upload Excel or CSV file with your leads</p>
              </div>
            </div>

            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors text-sm"
            >
              <Download className="h-4 w-4" />
              <span>Download Template</span>
            </button>
          </div>

          {/* Column Requirements Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-900 mb-2">📋 Required & Optional Columns:</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-blue-800 font-medium mb-1">✅ Required:</p>
                <ul className="text-blue-700 space-y-1">
                  <li>• <strong>Email</strong> (must have)</li>
                </ul>
              </div>
              <div>
                <p className="text-blue-800 font-medium mb-1">Optional (recommended):</p>
                <ul className="text-blue-700 space-y-1">
                  <li>• Name, Company, Title</li>
                  <li>• Phone, Industry, Location</li>
                  <li>• Notes</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-blue-600 mt-2">
              💡 Column names are case-insensitive. Use "Email" or "email", both work!
            </p>
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all ${
            dragActive
              ? 'border-purple-500 bg-purple-50'
              : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            disabled={uploading}
          />

          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader className="h-12 w-12 text-purple-600 animate-spin mb-4" />
              <p className="text-lg font-semibold text-gray-900">Importing leads...</p>
              <p className="text-sm text-gray-600 mt-2">Please wait while we process your file</p>
            </div>
          ) : (
            <label htmlFor="file-upload" className="cursor-pointer">
              <FileSpreadsheet className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-semibold text-gray-900 mb-2">
                Drop your Excel or CSV file here
              </p>
              <p className="text-sm text-gray-600 mb-4">
                or <span className="text-purple-600 font-medium">browse files</span>
              </p>
              <p className="text-xs text-gray-500">
                Supported formats: .xlsx, .xls, .csv (Required column: email)
              </p>
            </label>
          )}
        </div>

        {/* Import Result */}
        {importResult && (
          <motion.div
            className={`mt-6 p-6 rounded-xl border-2 ${
              importResult.errors > 0
                ? 'bg-amber-50 border-amber-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="flex items-start gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                importResult.errors > 0 ? 'bg-amber-100' : 'bg-emerald-100'
              }`}>
                {importResult.errors > 0 ? (
                  <AlertCircle className="h-6 w-6 text-amber-600" />
                ) : (
                  <CheckCircle className="h-6 w-6 text-emerald-600" />
                )}
              </div>

              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${
                  importResult.errors > 0 ? 'text-amber-900' : 'text-emerald-900'
                }`}>
                  Import Complete
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Total Rows</p>
                    <p className="text-2xl font-bold text-gray-900">{importResult.total}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Imported</p>
                    <p className="text-2xl font-bold text-emerald-600">{importResult.imported}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Skipped</p>
                    <p className="text-2xl font-bold text-gray-600">{importResult.skipped}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Errors</p>
                    <p className="text-2xl font-bold text-red-600">{importResult.errors}</p>
                  </div>
                </div>

                {/* Warnings */}
                {importResult.warnings && importResult.warnings.length > 0 && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Column Warnings:
                    </p>
                    <ul className="text-sm text-amber-800 space-y-1">
                      {importResult.warnings.map((warning, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-600">•</span>
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Column Mapping */}
                {importResult.column_mapping && (
                  <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Column Mapping:</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(importResult.column_mapping.found).map(([field, column]) => (
                        <div key={field} className="flex justify-between">
                          <span className="text-gray-600 capitalize">{field}:</span>
                          <span className={`font-medium ${column === 'Not found' ? 'text-red-600' : 'text-emerald-600'}`}>
                            {column}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {importResult.error_details && importResult.error_details.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-red-900 mb-2">Error Details:</p>
                    <ul className="text-sm text-red-800 space-y-1">
                      {importResult.error_details.map((error, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-red-600">•</span>
                          <span>{error}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Email Exclusions */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 bg-gradient-to-br from-red-600 to-orange-600 rounded-xl flex items-center justify-center">
            <Ban className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Email Exclusions</h2>
            <p className="text-sm text-gray-600">Emails that won't receive campaign emails ({exclusions.length} excluded)</p>
          </div>
        </div>

        {/* Add Exclusion */}
        <div className="mb-4 flex gap-2">
          <input
            type="email"
            value={newExclusion}
            onChange={(e) => setNewExclusion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
            placeholder="Enter email to exclude..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
          <button
            onClick={addExclusion}
            disabled={addingExclusion}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {addingExclusion ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span>Exclude</span>
          </button>
        </div>

        {/* Exclusions List */}
        {exclusions.length > 0 ? (
          <div className="space-y-2">
            {exclusions.map((exclusion) => (
              <div
                key={exclusion.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex items-center gap-3">
                  <Ban className="h-4 w-4 text-red-600" />
                  <div>
                    <p className="font-medium text-gray-900">{exclusion.email}</p>
                    {exclusion.reason && (
                      <p className="text-xs text-gray-500">{exclusion.reason}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeExclusion(exclusion.id)}
                  className="p-2 hover:bg-red-50 rounded-lg transition-colors group"
                >
                  <Trash2 className="h-4 w-4 text-gray-400 group-hover:text-red-600" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Ban className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p>No emails excluded</p>
            <p className="text-sm">Add emails above to exclude them from campaigns</p>
          </div>
        )}
      </motion.div>

      {/* Campaign Launcher */}
      {newLeadsCount > 0 && (
        <motion.div
          className="bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl shadow-lg p-8 mb-8 text-white"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">Ready to Launch Campaign?</h3>
              <p className="text-purple-100 text-lg">
                You have <strong>{newLeadsCount.toLocaleString()} leads</strong> ready to receive personalized emails from your AI team
              </p>
              {exclusions.length > 0 && (
                <p className="text-purple-200 text-sm mt-2">
                  ⚠️ {exclusions.length} email(s) are excluded and won't receive emails
                </p>
              )}
            </div>

            <button
              onClick={handleLaunchCampaign}
              disabled={launchingCampaign}
              className="flex items-center gap-3 px-8 py-4 bg-white text-purple-600 rounded-xl font-bold text-lg hover:shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {launchingCampaign ? (
                <>
                  <Loader className="h-6 w-6 animate-spin" />
                  <span>Launching...</span>
                </>
              ) : (
                <>
                  <Send className="h-6 w-6" />
                  <span>Start Campaign</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}

      {/* Leads Table */}
      <motion.div
        className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            All Leads ({totalLeadsCount.toLocaleString()})
            {dbTotal !== undefined && dbTotal > leads.length && (
              <span className="ml-2 text-sm font-normal text-gray-500">newest {leads.length.toLocaleString()} loaded</span>
            )}
          </h2>

          <div className="flex items-center gap-3">
            {selectedLeads.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span>Delete {selectedLeads.size} Selected</span>
              </button>
            )}

            <button
              onClick={handleAddLead}
              disabled={addingLead}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition-all disabled:opacity-50"
            >
              {addingLead ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              <span>Add Lead</span>
            </button>

            {isShareholdersSeg && (
              <button
                onClick={handleMoveIndvToIndividual}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                title="Move all named (Indv) leads to the Individual Shareholders segment"
              >
                <UserPlus className="h-4 w-4" />
                <span>Move Indv → Individual Shareholders</span>
              </button>
            )}
          </div>
        </div>

        {/* Segment filter bar */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Segments</span>
          <div className="relative">
            <button
              onClick={() => setSegMenuOpen((o) => !o)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:border-gray-300 min-w-[220px]"
            >
              {activeSegment ? (
                <>
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: segmentMeta(activeSegment)?.color || '#6366f1' }} />
                  <span className="text-gray-900 truncate">{segmentMeta(activeSegment)?.label || activeSegment}</span>
                  <span className="text-xs text-gray-400">{(segmentMeta(activeSegment)?.lead_count ?? 0).toLocaleString()}</span>
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-700">All Segments</span>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />
            </button>
            {segMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => { setSegMenuOpen(false); setSegSearch(''); }} />
                <div className="absolute z-40 mt-1 w-72 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                  <div className="p-2 sticky top-0 bg-white border-b border-gray-100">
                    <input
                      autoFocus
                      value={segSearch}
                      onChange={(e) => setSegSearch(e.target.value)}
                      placeholder="Search segments…"
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => { setActiveSegment(''); setSegMenuOpen(false); setSegSearch(''); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${activeSegment === '' ? 'bg-gray-50 font-semibold' : ''}`}
                  >
                    <span className="flex items-center gap-2"><Layers className="h-3.5 w-3.5 text-gray-400" /> All Segments</span>
                    <span className="text-xs text-gray-400">{(segments.reduce((a, s) => a + (s.lead_count ?? 0), 0) + unsegmentedCount).toLocaleString()}</span>
                  </button>
                  {segments
                    .filter((s) => s.label.toLowerCase().includes(segSearch.trim().toLowerCase()))
                    .map((s) => (
                      <button
                        key={s.key}
                        onClick={() => { setActiveSegment(s.key); setSegMenuOpen(false); setSegSearch(''); }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${activeSegment === s.key ? 'bg-gray-50 font-semibold' : ''}`}
                        title={s.description || s.label}
                      >
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color || '#6366f1' }} />
                        <span className="truncate flex-1">{s.label}</span>
                        <span className="text-xs text-gray-400">{(s.lead_count ?? 0).toLocaleString()}</span>
                      </button>
                    ))}
                  {segments.filter((s) => s.label.toLowerCase().includes(segSearch.trim().toLowerCase())).length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-400 text-center">No segments match</div>
                  )}
                  {unsegmentedCount > 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">Unsegmented: {unsegmentedCount.toLocaleString()}</div>
                  )}
                </div>
              </>
            )}
          </div>
          {activeSegment && (
            <button onClick={() => setActiveSegment('')} className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline">
              Clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Sort by Name */}
            <button
              onClick={() => setNameSortDir(d => d === null ? 'asc' : d === 'asc' ? 'desc' : null)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                nameSortDir
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-300 hover:bg-indigo-100'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              title="Sort leads by name"
            >
              {nameSortDir === 'asc'  && <ArrowUp   className="h-3.5 w-3.5" />}
              {nameSortDir === 'desc' && <ArrowDown  className="h-3.5 w-3.5" />}
              {nameSortDir === null   && <ArrowUpDown className="h-3.5 w-3.5" />}
              Name {nameSortDir === 'asc' ? 'A→Z' : nameSortDir === 'desc' ? 'Z→A' : ''}
            </button>

            <button
              onClick={addSegment}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add segment
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {leads.length === 0 ? (
            <div className="p-12 text-center">
              <FileSpreadsheet className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 font-medium text-lg mb-2">No leads yet</p>
              <p className="text-sm text-gray-500">Import your first batch of leads to get started</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedLeads.size > 0 && selectedLeads.size === leads.filter(l => l.source === 'scraped').length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Company</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Title</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Segment</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedLeads.map((lead, index) => {
                  const isScraped = lead.source === 'scraped';
                  return (
                    <motion.tr
                      key={lead.id}
                      className="hover:bg-gray-50 transition-colors"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + index * 0.02 }}
                    >
                      <td className="px-4 py-4">
                        {isScraped && (
                          <input
                            type="checkbox"
                            checked={selectedLeads.has(lead.id)}
                            onChange={() => toggleLeadSelection(lead.id)}
                            className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setTimelineEmail(lead.email)}
                          className="font-medium text-gray-900 hover:text-purple-600 hover:underline text-left"
                          title="View this lead's activity timeline"
                        >
                          {lead.email}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-900">{lead.name || '-'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-900">{lead.company || '-'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          {lead.company && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 uppercase tracking-wide flex-shrink-0">Corp</span>
                          )}
                          {isShareholdersSeg && lead.name && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-wide flex-shrink-0">Indv</span>
                          )}
                          <p className="text-gray-600 text-sm">{lead.title || '-'}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {lead.segment ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: segmentMeta(lead.segment)?.color || '#6366f1' }}
                          >
                            {segmentMeta(lead.segment)?.label || lead.segment}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          lead.status === 'new'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          {lead.status === 'new' && (
                            <button
                              onClick={() => handleSendEmailToLead(lead)}
                              disabled={sendingEmail === lead.id}
                              className="p-2 hover:bg-purple-50 rounded-lg transition-colors group disabled:opacity-50"
                              title="Send email to this lead"
                            >
                              {sendingEmail === lead.id ? (
                                <Loader className="h-4 w-4 animate-spin text-purple-600" />
                              ) : (
                                <Mail className="h-4 w-4 text-gray-400 group-hover:text-purple-600" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteSingle(lead.id, lead.email)}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors group"
                            title="Delete lead"
                          >
                            <Trash2 className="h-4 w-4 text-gray-400 group-hover:text-red-600" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Controls */}
        {leads.length > 0 && totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="text-sm text-gray-600">
              Showing {startIndex + 1} to {Math.min(endIndex, leads.length)} of {leads.length} leads
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent text-sm font-medium"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  // Show first page, last page, current page, and pages around current
                  const showPage =
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1);

                  if (!showPage) {
                    // Show ellipsis
                    if (page === currentPage - 2 || page === currentPage + 2) {
                      return <span key={page} className="px-2 text-gray-400">...</span>;
                    }
                    return null;
                  }

                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        page === currentPage
                          ? 'bg-purple-600 text-white'
                          : 'border border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent text-sm font-medium"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Column Mapping Modal */}
      {previewData && (
        <ColumnMappingModal
          isOpen={showMappingModal}
          onClose={() => {
            setShowMappingModal(false);
            setCurrentFile(null);
            setPreviewData(null);
          }}
          fileColumns={previewData.columns}
          suggestedMappings={previewData.suggested_mappings}
          sampleData={previewData.sample_data}
          filename={previewData.filename}
          totalRows={previewData.total_rows}
          onConfirm={handleConfirmMapping}
        />
      )}

      <LeadTimelineModal email={timelineEmail} onClose={() => setTimelineEmail(null)} />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle: string;
  icon: React.ElementType;
  gradient: string;
  delay: number;
}

function StatCard({ title, value, subtitle, icon: Icon, gradient, delay }: StatCardProps) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 relative overflow-hidden hover:shadow-xl transition-shadow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -4 }}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${gradient} opacity-5 rounded-full blur-2xl`} />

      <div className="relative">
        <div className={`h-12 w-12 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg mb-4`}>
          <Icon className="h-6 w-6 text-white" />
        </div>

        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          {title}
        </h3>

        <p className="text-3xl font-bold text-gray-900 mb-2">{value}</p>

        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </motion.div>
  );
}
