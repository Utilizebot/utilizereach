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
  Trophy,
  ChevronDown,
  Check,
  Building2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { logout } from '../lib/auth';
import { DEFAULT_BRAND_ID } from '../lib/config';
import { useConfig, useConfigContext } from '../context/ConfigContext';
import { useAuth } from '../hooks/useAuth';

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
  { path: '/winning',         label: 'Winning',      icon: Trophy,          gradient: 'from-amber-500 to-orange-600' },
  { path: '/agent-stream',    label: 'Stream',        icon: Radio,           gradient: 'from-violet-600 to-indigo-600' },
  { path: '/social-media',   label: 'Social',        icon: Share2,          gradient: 'from-pink-500 to-violet-600'   },
];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};

/**
 * Brand block of the top bar. Shows the ACTIVE brand; when the user can act
 * in more than one brand (or is a platform admin) it opens a brand switcher.
 * A single-brand user sees exactly the static block it always was.
 */
function BrandSwitcher() {
  const config = useConfig();
  const { activeBrandRow } = useConfigContext();
  const { brands, activeBrand, isPlatformAdmin, switchBrand } = useAuth();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Active brand's name: its dashboard config once loaded; before that, a
  // non-default brand shows its display name rather than the host's.
  const brandName =
    (activeBrandRow
      ? config.company.name
      : activeBrand && activeBrand.id !== DEFAULT_BRAND_ID
        ? activeBrand.display_name
        : config.company.name) || 'UtilizeReach';

  const canSwitch = brands.length > 1 || isPlatformAdmin;

  const block = (
    <>
      <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shrink-0">
        <Zap className="h-4 w-4 text-white" />
      </div>
      <div className="hidden sm:block leading-tight text-left">
        <p className="font-bold text-gray-900 text-[11px] whitespace-nowrap">{brandName}</p>
        <p className="text-[9px] text-gray-400">AI UtilizeReach</p>
      </div>
    </>
  );

  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2.5 px-3 shrink-0 border-r border-gray-100 h-full">
        {block}
      </div>
    );
  }

  const onPick = async (brandId: string) => {
    if (activeBrand && brandId === activeBrand.id) {
      setOpen(false);
      return;
    }
    setError(null);
    setSwitchingTo(brandId);
    const { error: err } = await switchBrand(brandId); // reloads the page on success
    if (err) {
      setSwitchingTo(null);
      setError(err.message || 'Could not switch brand');
    }
  };

  return (
    <div ref={ref} className="relative shrink-0 border-r border-gray-100 h-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch brand"
        className="flex items-center gap-2.5 px-3 h-full hover:bg-gray-50 transition-colors"
      >
        {block}
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-2 top-full mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 z-50 text-xs">
          <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Brands</p>
          <div role="listbox" className="max-h-72 overflow-y-auto">
            {brands.map((b) => {
              const isActive = activeBrand?.id === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={!!switchingTo}
                  onClick={() => onPick(b.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{b.display_name || b.slug}</span>
                    <span className="block text-[10px] text-gray-400">{ROLE_LABELS[b.role] || b.role}</span>
                  </span>
                  {switchingTo === b.id ? (
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
                  ) : isActive ? (
                    <Check size={14} className="shrink-0" />
                  ) : null}
                </button>
              );
            })}
            {brands.length === 0 && (
              <p className="px-3 py-2 text-gray-400">No other brands</p>
            )}
          </div>
          {error && <p className="px-3 py-1.5 text-[11px] text-red-600">{error}</p>}
          {isPlatformAdmin && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <Link
                to="/settings/brands"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Building2 size={14} className="text-gray-400" />
                Manage brands
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

        {/* Brand – always visible, never shrinks (active brand + switcher) */}
        <BrandSwitcher />

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
