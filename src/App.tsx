import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LeadForm } from './components/Form/LeadForm';
import { ExecutiveForm } from './components/Form/ExecutiveForm';
import { ModularForm } from './components/Form/ModularForm';
import { Dashboard } from './pages/Dashboard';
import { Success } from './pages/Success';
import { Login } from './pages/Login';
import { Scraper } from './pages/Scraper';
import { LeadFunnel } from './pages/LeadFunnel';
import { LeadsManagement } from './pages/LeadsManagement';
import { Emails } from './pages/Emails';
import { Campaigns } from './pages/Campaigns';
import { Replies } from './pages/Replies';
import { OutboundAnalytics } from './pages/OutboundAnalytics';
import { WhatsWinning } from './pages/WhatsWinning';
import { EmailAccounts } from './pages/EmailAccounts';
import { AgentStream } from './pages/AgentStream';
import { SocialMedia } from './pages/SocialMedia';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './components/DashboardLayout';
import { SettingsLayout } from './pages/Settings/SettingsLayout';
import { ProfileSettings } from './pages/Settings/ProfileSettings';
import { UsersSettings } from './pages/Settings/UsersSettings';
import { ApiKeysSettings } from './pages/Settings/ApiKeysSettings';
import { SchedulerSettings } from './pages/Settings/SchedulerSettings';
import { EmailAISettings } from './pages/Settings/EmailAISettings';
import { BrandSettings } from './pages/Settings/BrandSettings';
import { BrandsSettings } from './pages/Settings/BrandsSettings';
import { SetupWizard } from './pages/SetupWizard';
import { useConfigContext } from './context/ConfigContext';
import { NexusDashboard } from './pages/NexusDashboard';
import { NexusAgentHub } from './pages/NexusAgentHub';
import { NexusStakeholders } from './pages/NexusStakeholders';
import NexusCampaignBuilder from './pages/NexusCampaignBuilder';
import NexusAuditLogs from './pages/NexusAuditLogs';
import { NexusSettings } from './pages/NexusSettings';

function AppContent() {
  const { loading, isSetupComplete } = useConfigContext();

  // Show loading spinner while checking config
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Show setup wizard if not configured
  if (!isSetupComplete) {
    return <SetupWizard />;
  }

  // Normal app routing
  return (
    <Router>
      <Routes>
        {/* Config-driven lead capture form (branding set in the Setup Wizard) */}
        <Route path="/" element={<ModularForm />} />
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
      </Routes>
    </Router>
  );
}

function App() {
  return <AppContent />;
}

export default App;
