import type { ReactNode } from 'react';
import { NexusHeader } from './NexusHeader';

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: string[];
  actions?: ReactNode;
}

export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <span>Nexus</span>
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
                <span className={i === breadcrumb.length - 1 ? 'text-slate-700 font-medium' : ''}>{crumb}</span>
              </span>
            ))}
          </div>
        )}
        <h1 className="text-2xl font-bold text-slate-900 leading-tight">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-shrink-0 ml-6">{actions}</div>}
    </div>
  );
}

interface NexusLayoutProps {
  children: ReactNode;
  pendingApprovals?: number;
  agentStatuses?: { accounting: boolean; bd: boolean; admin: boolean };
  onEmergencyPause?: () => void;
}

export function NexusLayout({ children, pendingApprovals = 0, agentStatuses, onEmergencyPause }: NexusLayoutProps) {
  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <NexusHeader
        pendingApprovals={pendingApprovals}
        agentStatuses={agentStatuses}
        onEmergencyPause={onEmergencyPause}
      />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}

export default NexusLayout;
