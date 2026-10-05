/**
 * SettingsLayout Component
 *
 * Layout for settings pages with sidebar navigation
 *
 * Phase: 1.10 - Settings Page Layout
 * Created: 2025-10-16
 * Updated: multi-brand - nav gated by permission, active brand + role shown
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User,
  Key,
  Search,
  FileDown,
  ArrowLeft,
  Settings as SettingsIcon,
  LayoutDashboard,
  Database,
  Mail,
  TrendingUp,
  Upload,
  Users,
  Clock,
  Sparkles,
  Building2,
  Layers
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  permission?: string; // hidden unless the current user holds this permission
  platformAdminOnly?: boolean; // hidden unless the user is a platform admin
}

const navItems: NavItem[] = [
  {
    path: '/settings/profile',
    label: 'Profile',
    icon: <User size={20} />,
  },
  {
    path: '/settings/brand',
    label: 'Brand',
    icon: <Building2 size={20} />,
    permission: 'settings.manage',
  },
  {
    path: '/settings/users',
    label: 'Users',
    icon: <Users size={20} />,
    permission: 'users.view',
  },
  {
    path: '/settings/scheduler',
    label: 'Automated Campaigns',
    icon: <Clock size={20} />,
    permission: 'settings.manage',
  },
  {
    path: '/settings/email-ai',
    label: 'AI Email Settings',
    icon: <Sparkles size={20} />,
    permission: 'settings.manage',
  },
  {
    path: '/settings/api-keys',
    label: 'API Keys',
    icon: <Key size={20} />,
    permission: 'apikeys.manage',
  },
  {
    path: '/settings/scraper',
    label: 'Scraper Preferences',
    icon: <Search size={20} />,
  },
  {
    path: '/settings/export',
    label: 'Export Formats',
    icon: <FileDown size={20} />,
  },
  {
    path: '/settings/brands',
    label: 'Brands',
    icon: <Layers size={20} />,
    platformAdminOnly: true,
  },
];

// Quick navigation to main app sections
const quickNavItems = [
  {
    path: '/dashboard',
    label: 'Analytics Dashboard',
    icon: <LayoutDashboard size={18} />,
    color: 'from-blue-500 to-cyan-500'
  },
  {
    path: '/leads',
    label: 'Lead Funnel',
    icon: <TrendingUp size={18} />,
    color: 'from-purple-500 to-pink-500'
  },
  {
    path: '/leads-management',
    label: 'Lead Management',
    icon: <Upload size={18} />,
    color: 'from-indigo-500 to-purple-500'
  },
  {
    path: '/emails',
    label: 'Sent Emails',
    icon: <Mail size={18} />,
    color: 'from-emerald-500 to-teal-500'
  },
  {
    path: '/email-accounts',
    label: 'Email Accounts',
    icon: <Users size={18} />,
    color: 'from-orange-500 to-red-500'
  },
  {
    path: '/scraper',
    label: 'Lead Scraper',
    icon: <Database size={18} />,
    color: 'from-rose-500 to-pink-500'
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  sales_rep: 'Member',
  viewer: 'Viewer',
};

export function SettingsLayout() {
  const navigate = useNavigate();
  const { salesRep, isAdmin, can, isPlatformAdmin, activeBrand, brands } = useAuth();

  // Filter nav items based on the current user's permissions in the active brand
  const visibleNavItems = navItems.filter((item) => {
    if (item.platformAdminOnly) return isPlatformAdmin;
    return !item.permission || can(item.permission);
  });

  const roleText = isPlatformAdmin
    ? 'Platform Admin'
    : ROLE_LABELS[activeBrand?.role || ''] || (isAdmin ? 'Admin' : 'Member');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/dashboard')}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
              <div className="flex items-center gap-3">
                <div className="bg-primary p-2 rounded-lg">
                  <SettingsIcon size={24} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                  <p className="text-sm text-gray-600">
                    Manage your account and preferences
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="btn-secondary flex items-center gap-2"
              >
                <LayoutDashboard size={20} />
                Dashboard
              </button>
              <button
                onClick={() => navigate('/scraper')}
                className="btn-primary flex items-center gap-2"
              >
                <Database size={20} />
                Lead Scraper
              </button>
              <div className="text-right ml-4 border-l border-gray-300 pl-4">
                <p className="text-sm font-medium text-gray-900">
                  {salesRep?.full_name}
                </p>
                <p className="text-xs text-gray-600">
                  {roleText}
                  {activeBrand?.display_name && (
                    <span className="text-gray-400"> · {activeBrand.display_name}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <aside className="w-64 flex-shrink-0">
            <motion.nav
              className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sticky top-24"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              {/* Active brand */}
              {activeBrand && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                  <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">
                    Active brand{(brands?.length ?? 0) > 1 ? ` · 1 of ${brands.length}` : ''}
                  </p>
                  <p className="text-sm font-bold text-gray-900 truncate flex items-center gap-1.5 mt-0.5">
                    <Building2 size={14} className="text-indigo-600 flex-shrink-0" />
                    {activeBrand.display_name}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">Your role: {roleText}</p>
                </div>
              )}

              <div className="space-y-1">
                {visibleNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                        isActive
                          ? 'bg-primary text-white shadow-md'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`
                    }
                  >
                    {item.icon}
                    <span className="font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </div>

              {/* Quick Navigation */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 mb-3">
                  Quick Navigation
                </p>
                <div className="space-y-1">
                  {quickNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-all group"
                    >
                      <div className={`p-1.5 rounded-lg bg-gradient-to-br ${item.color} text-white`}>
                        {item.icon}
                      </div>
                      <span className="text-sm font-medium group-hover:text-gray-900">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>

              {/* Navigation Helper */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500 px-4">
                  {isPlatformAdmin
                    ? 'You have platform-wide administrative access'
                    : isAdmin
                      ? 'You have full administrative access to this brand'
                      : 'Some settings are admin-only'}
                </p>
              </div>
            </motion.nav>
          </aside>

          {/* Content Area */}
          <main className="flex-1 min-w-0">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Outlet />
            </motion.div>
          </main>
        </div>
      </div>
    </div>
  );
}
