import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
// Eager: the public front door and the sign-in page ship in the entry chunk.
import Landing from './pages/Landing';
import { Login } from './pages/Login';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './components/DashboardLayout';
import { useConfigContext } from './context/ConfigContext';

// Everything else is code-split, so a first visit to "/" does not download
// the dashboard (recharts, Nexus pages, settings) it never uses.
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const LeadForm = named(() => import('./components/Form/LeadForm'), 'LeadForm');
const ExecutiveForm = named(() => import('./components/Form/ExecutiveForm'), 'ExecutiveForm');
const ModularForm = named(() => import('./components/Form/ModularForm'), 'ModularForm');
const Dashboard = named(() => import('./pages/Dashboard'), 'Dashboard');
const Success = named(() => import('./pages/Success'), 'Success');
const Scraper = named(() => import('./pages/Scraper'), 'Scraper');
const LeadFunnel = named(() => import('./pages/LeadFunnel'), 'LeadFunnel');
const LeadsManagement = named(() => import('./pages/LeadsManagement'), 'LeadsManagement');
const Emails = named(() => import('./pages/Emails'), 'Emails');
const Campaigns = named(() => import('./pages/Campaigns'), 'Campaigns');
const Replies = named(() => import('./pages/Replies'), 'Replies');
const OutboundAnalytics = named(() => import('./pages/OutboundAnalytics'), 'OutboundAnalytics');
const WhatsWinning = named(() => import('./pages/WhatsWinning'), 'WhatsWinning');
const EmailAccounts = named(() => import('./pages/EmailAccounts'), 'EmailAccounts');
const AgentStream = named(() => import('./pages/AgentStream'), 'AgentStream');
const SocialMedia = named(() => import('./pages/SocialMedia'), 'SocialMedia');
const SettingsLayout = named(() => import('./pages/Settings/SettingsLayout'), 'SettingsLayout');
const ProfileSettings = named(() => import('./pages/Settings/ProfileSettings'), 'ProfileSettings');
const UsersSettings = named(() => import('./pages/Settings/UsersSettings'), 'UsersSettings');
const ApiKeysSettings = named(() => import('./pages/Settings/ApiKeysSettings'), 'ApiKeysSettings');
const SchedulerSettings = named(() => import('./pages/Settings/SchedulerSettings'), 'SchedulerSettings');
const EmailAISettings = named(() => import('./pages/Settings/EmailAISettings'), 'EmailAISettings');
const BrandSettings = named(() => import('./pages/Settings/BrandSettings'), 'BrandSettings');
const BrandsSettings = named(() => import('./pages/Settings/BrandsSettings'), 'BrandsSettings');
const SetupWizard = named(() => import('./pages/SetupWizard'), 'SetupWizard');
const NexusDashboard = named(() => import('./pages/NexusDashboard'), 'NexusDashboard');
const NexusAgentHub = named(() => import('./pages/NexusAgentHub'), 'NexusAgentHub');
const NexusStakeholders = named(() => import('./pages/NexusStakeholders'), 'NexusStakeholders');
const NexusSettings = named(() => import('./pages/NexusSettings'), 'NexusSettings');
const NexusCampaignBuilder = lazy(() => import('./pages/NexusCampaignBuilder'));
const NexusAuditLogs = lazy(() => import('./pages/NexusAuditLogs'));

function Spinner() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
    </div>
  );
}

/**
 * Config gate for every route except the public landing page: wait for the
 * host config, and show the Setup Wizard until setup is complete. "/" sits
 * outside it so the landing paints immediately, with or without the backend.
 */
function ConfigGate() {
  const { loading, isSetupComplete } = useConfigContext();
  if (loading) return <Spinner />;
  if (!isSetupComplete) return <SetupWizard />;
  return <Outlet />;
}

function AppContent() {
  return (
    <Router>
      <Suspense fallback={<Spinner />}>
      <Routes>
        {/* Public landing page: static, outside the config gate, no /api needed */}
        <Route path="/" element={<Landing />} />
        <Route element={<ConfigGate />}>
        {/* Alternate form layouts */}
        <Route path="/form" element={<ExecutiveForm />} />
        <Route path="/form-simple" element={<ModularForm />} />
        <Route path="/form-classic" element={<LeadForm />} />
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<SetupWizard />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Dashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Scraper - Phase 3 */}
        <Route
          path="/scraper"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Scraper />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Email Marketing - Lead Funnel */}
        <Route
          path="/leads"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <LeadFunnel />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Email Marketing - Lead Management */}
        <Route
          path="/leads-management"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <LeadsManagement />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Outbound performance — What's Winning + AI recommendations */}
        <Route
          path="/winning"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <WhatsWinning />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Email Marketing - Emails Dashboard */}
        <Route
          path="/emails"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Emails />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Campaigns - monitor each campaign + A/B */}
        <Route
          path="/campaigns"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Campaigns />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Replies inbox */}
        <Route
          path="/replies"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Replies />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Outbound analytics */}
        <Route
          path="/outbound-analytics"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <OutboundAnalytics />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Agent Activity Stream */}
        <Route
          path="/agent-stream"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <AgentStream />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Email Marketing - Email Accounts Management */}
        <Route
          path="/email-accounts"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <EmailAccounts />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Settings Routes - Nested with layout */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsLayout />
            </ProtectedRoute>
          }
        >
          {/* Redirect /settings to /settings/profile */}
          <Route index element={<Navigate to="/settings/profile" replace />} />

          {/* Settings Pages */}
          <Route path="profile" element={<ProfileSettings />} />
          <Route path="users" element={<ProtectedRoute requiredPermission="users.view"><UsersSettings /></ProtectedRoute>} />

          {/* Active brand: identity, branding, sender settings */}
          <Route path="brand" element={<ProtectedRoute requiredPermission="settings.manage"><BrandSettings /></ProtectedRoute>} />

          {/* Brand catalog - platform admins only (page re-checks isPlatformAdmin) */}
          <Route path="brands" element={<ProtectedRoute requiredPermission="brands.manage"><BrandsSettings /></ProtectedRoute>} />

          {/* Automated Campaign Scheduler */}
          <Route path="scheduler" element={<ProtectedRoute requiredPermission="settings.manage"><SchedulerSettings /></ProtectedRoute>} />

          {/* AI Email Settings */}
          <Route path="email-ai" element={<ProtectedRoute requiredPermission="settings.manage"><EmailAISettings /></ProtectedRoute>} />

          {/* API Keys Management - Phase 2 */}
          <Route path="api-keys" element={<ProtectedRoute requiredPermission="apikeys.manage"><ApiKeysSettings /></ProtectedRoute>} />
          <Route
            path="scraper"
            element={
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Scraper Preferences</h2>
                <p className="text-gray-600">Coming in Phase 4...</p>
              </div>
            }
          />
          <Route
            path="export"
            element={
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Export Formats</h2>
                <p className="text-gray-600">Coming in Phase 5...</p>
              </div>
            }
          />
        </Route>

        <Route path="/success" element={<Success />} />

        {/* Nexus Marketing Engine — Autonomous Agent System */}
        <Route
          path="/social-media"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <SocialMedia />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Nexus APIs are brand-scoped and require auth, so the pages do too */}
        <Route path="/nexus" element={<ProtectedRoute><NexusDashboard /></ProtectedRoute>} />
        <Route path="/nexus/agent-hub" element={<ProtectedRoute><NexusAgentHub /></ProtectedRoute>} />
        <Route path="/nexus/stakeholders" element={<ProtectedRoute><NexusStakeholders /></ProtectedRoute>} />
        <Route path="/nexus/campaigns" element={<ProtectedRoute><NexusCampaignBuilder /></ProtectedRoute>} />
        <Route path="/nexus/audit-logs" element={<ProtectedRoute><NexusAuditLogs /></ProtectedRoute>} />
        <Route path="/nexus/settings" element={<ProtectedRoute><NexusSettings /></ProtectedRoute>} />
        </Route>
      </Routes>
      </Suspense>
    </Router>
  );
}

function App() {
  return <AppContent />;
}

export default App;
