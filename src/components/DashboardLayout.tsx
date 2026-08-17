import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Mail,
  TrendingUp,
  Settings,
  LogOut,
  Zap,
  Search,
  Users,
  Upload,
  Radio,
  Share2,
  Megaphone,
  MessageCircle,
  BarChart3,
} from 'lucide-react';
import { logout } from '../lib/auth';
import { getConfig } from '../lib/config';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const allNavItems = [
  { path: '/emails',          label: 'Emails',       icon: Mail,            gradient: 'from-emerald-600 to-teal-600'  },
  { path: '/replies',         label: 'Replies',       icon: MessageCircle,   gradient: 'from-rose-500 to-pink-600'     },
  { path: '/campaigns',       label: 'Campaigns',     icon: Megaphone,       gradient: 'from-fuchsia-600 to-purple-600' },
  { path: '/leads',           label: 'Funnel',        icon: TrendingUp,      gradient: 'from-purple-600 to-pink-600'   },
  { path: '/leads-management',label: 'Leads',         icon: Upload,          gradient: 'from-indigo-600 to-purple-600' },
  { path: '/email-accounts',  label: 'Accounts',      icon: Users,           gradient: 'from-purple-600 to-indigo-600' },
  { path: '/scraper',         label: 'Scraper',       icon: Search,          gradient: 'from-orange-600 to-red-600'    },
  { path: '/outbound-analytics', label: 'Analytics',  icon: BarChart3,       gradient: 'from-blue-600 to-cyan-600'     },
  { path: '/agent-stream',    label: 'Stream',        icon: Radio,           gradient: 'from-violet-600 to-indigo-600' },
  { path: '/social-media',   label: 'Social',        icon: Share2,          gradient: 'from-pink-500 to-violet-600'   },
];

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/settings') return location.pathname.startsWith('/settings');
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">

      {/* ── Top bar: brand | scrollable nav | settings + logout ── */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 shadow-sm z-40 flex items-center">

        {/* Brand – always visible, never shrinks */}
        <div className="flex items-center gap-2.5 px-3 shrink-0 border-r border-gray-100 h-full">
          <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="font-bold text-gray-900 text-[11px] whitespace-nowrap">{getConfig().company.name || 'UtilizeReach'}</p>
            <p className="text-[9px] text-gray-400">AI UtilizeReach</p>
          </div>
        </div>

        {/* Scrollable nav – fills all available space, scroll on small screens */}
        <div className="flex-1 overflow-x-auto min-w-0 h-full">
          <nav className="flex items-center gap-1 px-2 h-full" style={{ fontSize: '12px', minWidth: 'max-content' }}>
            {allNavItems.map(item => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link key={item.path} to={item.path} className="shrink-0">
                  <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-all ${
                    active
                      ? `bg-gradient-to-r ${item.gradient} text-white shadow-md`
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                    <Icon size={14} className={active ? 'text-white' : 'text-gray-400'} />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Settings + Logout – always visible, never shrinks */}
        <div className="flex items-center gap-0.5 px-2 shrink-0 border-l border-gray-100 h-full">
          <Link to="/settings">
            <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs whitespace-nowrap transition-all ${
              isActive('/settings') ? 'bg-gray-900 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'
            }`}>
              <Settings size={14} />
              <span className="hidden sm:inline">Settings</span>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-xs text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="min-h-screen pt-20 px-4 md:px-6 pb-8">
        {children}
      </main>

    </div>
  );
}
