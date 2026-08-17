/**
 * Login Page — split-panel, tenant-branded
 *
 * Left: dark brand panel with animated signal lines in the tenant accent
 * color (config.branding.primaryColor). Right: the sign-in form.
 * All auth logic unchanged (useAuth.signIn + sales_reps check).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, ArrowUpRight, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getConfig, loadConfig } from '../lib/config';

const FEATURES = [
  'AI-personalized outreach at scale',
  'Open, click & reply tracking',
  'Lead scraping and enrichment',
];

/** Three thin signal curves that draw themselves in on load. */
function SignalLines({ accent }: { accent: string }) {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 640 900"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path
        className="login-signal"
        d="M-40 620 C 120 600, 180 470, 320 470 S 540 560, 700 430"
        stroke={accent}
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <path
        className="login-signal login-signal-2"
        d="M-40 700 C 140 690, 220 540, 360 545 S 560 660, 700 540"
        stroke={accent}
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <path
        className="login-signal login-signal-3"
        d="M-40 545 C 100 530, 240 410, 380 415 S 580 470, 700 340"
        stroke={accent}
        strokeOpacity="0.14"
        strokeWidth="1.5"
      />
      {/* fine dot grid, barely there */}
      <g fill="#ffffff" fillOpacity="0.05">
        {Array.from({ length: 11 }).map((_, col) =>
          Array.from({ length: 16 }).map((_, row) => (
            <circle key={`${col}-${row}`} cx={40 + col * 56} cy={40 + row * 56} r="1" />
          ))
        )}
      </g>
    </svg>
  );
}

export function Login() {
  const navigate = useNavigate();
  const { signIn, isAuthenticated, salesRep } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [, setConfigLoaded] = useState(false);

  // Re-render once the runtime config (tenant branding) has loaded
  useEffect(() => {
    loadConfig().then(() => setConfigLoaded(true));
  }, []);

  const config = getConfig();
  const company = config.company.name || 'UtilizeReach';
  const tagline = config.company.tagline || 'AI-powered lead automation';
  // Tenant accent; the stock default (#6366f1) maps to the design-system cyan
  const configured = config.branding?.primaryColor?.toLowerCase();
  const accent = configured && configured !== '#6366f1' ? configured : '#2aa8e0';

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated && salesRep) {
      navigate('/emails');
    }
  }, [isAuthenticated, salesRep, navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { error: signInError } = await signIn(email, password);
      if (signInError) throw signInError;
      navigate('/emails');
    } catch (err: any) {
      console.error('Login error:', err);
      let errorMessage = err.message || 'An error occurred';
      if (errorMessage.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please try again.';
      } else if (errorMessage.includes('Email not confirmed')) {
        errorMessage = 'Please check your email to confirm your account.';
      } else if (errorMessage.includes('No sales rep record found')) {
        errorMessage = 'Your account is not set up properly. Please contact an administrator.';
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState && e.getModifierState('CapsLock'));
  };

  return (
    <div className="min-h-screen bg-gray-50 grid lg:grid-cols-[1fr_minmax(480px,42%)]">
      {/* ------------------------------------------------ brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#191917] px-14 py-12">
        <SignalLines accent={accent} />

        {/* wordmark */}
        <div className="relative">
          <p className="text-[15px] font-semibold text-white tracking-tight">{company}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
            UtilizeReach
          </p>
        </div>

        {/* statement */}
        <div className="relative max-w-md">
          <h1 className="text-[34px] leading-[1.15] font-semibold text-white tracking-tight text-balance">
            Every lead worked.
            <br />
            <span style={{ color: accent }}>Every send accounted for.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-gray-400">{tagline}</p>

          <ul className="mt-10 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-[13px] text-gray-300">
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${accent}22` }}
                >
                  <Check size={10} style={{ color: accent }} strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* footer */}
        <div className="relative flex items-center justify-between text-[11px] text-gray-600">
          <span className="font-mono">Internal dashboard</span>
          <a
            href="/"
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            Public site <ArrowUpRight size={12} />
          </a>
        </div>
      </div>

      {/* ------------------------------------------------ form panel */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-16 lg:border-l lg:border-gray-200 bg-white">
        {/* mobile wordmark */}
        <div className="mb-10 lg:hidden">
          <p className="text-[15px] font-semibold text-gray-900 tracking-tight">{company}</p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400">
            UtilizeReach
          </p>
        </div>

        <div className="mx-auto w-full max-w-[360px]">
          <div className="login-rise">
            <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Welcome back</h2>
            <p className="mt-1.5 text-[13px] text-gray-500">
              Sign in to the {company} dashboard
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-snug text-red-700"
            >
              <AlertCircle size={15} className="mt-px shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleAuth} className="mt-7 space-y-5">
            <div className="login-rise login-rise-2">
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-[12px] font-medium text-gray-700"
              >
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                autoFocus
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-shadow focus:border-transparent focus:ring-2"
                style={{ ['--tw-ring-color' as string]: accent }}
              />
            </div>

            <div className="login-rise login-rise-2">
              <div className="mb-1.5 flex items-baseline justify-between">
                <label
                  htmlFor="login-password"
                  className="block text-[12px] font-medium text-gray-700"
                >
                  Password
                </label>
                {capsLock && (
                  <span className="text-[11px] font-medium text-amber-600">Caps Lock is on</span>
                )}
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={trackCapsLock}
                  onKeyDown={trackCapsLock}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  minLength={6}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 pr-10 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-shadow focus:border-transparent focus:ring-2"
                  style={{ ['--tw-ring-color' as string]: accent }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="login-rise login-rise-3">
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
                style={{ backgroundColor: accent }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(0.92)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = '')}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          <p className="login-rise login-rise-3 mt-8 text-center text-xs text-gray-400">
            Need access? Ask your administrator to create an account.
          </p>
        </div>

        {/* form-panel footer */}
        <p className="mt-12 text-center text-[10px] uppercase tracking-[0.16em] text-gray-300 lg:absolute lg:bottom-6 lg:right-16 lg:mt-0">
          Powered by UtilizeReach
        </p>
      </div>
    </div>
  );
}
