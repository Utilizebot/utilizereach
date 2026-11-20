/**
 * Settings > Integrations - third-party services connected to the ACTIVE brand.
 *
 * Modular: every integration is one entry in INTEGRATIONS below (metadata +
 * a panel component that renders inside the shared IntegrationCard shell).
 * To add one, write a panel in src/components/integrations/ and register it.
 *
 * Requires settings.manage (route-guarded in App.tsx, re-checked here).
 */

import { BarChart3, Plug, Shield } from 'lucide-react';
import type { ComponentType } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { IntegrationMeta, IntegrationPanelProps } from '../../components/integrations/IntegrationCard';
import { GoogleAnalyticsIntegration } from '../../components/integrations/GoogleAnalyticsIntegration';

interface IntegrationDefinition extends IntegrationMeta {
  Panel: ComponentType<IntegrationPanelProps>;
}

const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    description:
      'See live website visitors on your dashboard and which outreach campaigns and sender personas drive visits.',
    icon: BarChart3,
    gradient: 'from-orange-500 to-amber-500',
    category: 'Analytics',
    Panel: GoogleAnalyticsIntegration,
  },
];

export function IntegrationsSettings() {
  const { can, activeBrand } = useAuth();

  if (!can('settings.manage')) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
        <Shield className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="font-semibold text-gray-800">Brand admins only</p>
        <p className="text-sm text-gray-500 mt-1">You need permission to manage settings for this brand.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shadow">
          <Plug className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-900">Integrations</h2>
          <p className="text-gray-600 text-sm mt-0.5">
            Connect outside services to{' '}
            {activeBrand?.display_name ? <b className="text-gray-900">{activeBrand.display_name}</b> : 'this brand'}.
            Connections are per brand and only visible inside it.
          </p>
        </div>
      </div>

      {INTEGRATIONS.map(({ Panel, ...meta }, i) => (
        <Panel key={meta.id} meta={meta} delay={0.05 * i} />
      ))}
    </div>
  );
}
