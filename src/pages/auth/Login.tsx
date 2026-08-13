import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Eye, EyeOff, Loader2, Mail, Lock, Info } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuth, DEMO_EMAIL, DEMO_PASSWORD } from '@/context/AuthContext';
import { classNames } from '@/lib/format';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');

  if (isAuthenticated) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = 'Work email is required';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'Enter a valid email address';
    if (!password) next.password = 'Password is required';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    // Simulate a network round-trip.
    window.setTimeout(() => {
      const ok = login(email, password, remember);
      if (ok) {
        navigate(from, { replace: true });
      } else {
        setLoading(false);
        setFormError('Invalid email or password. Please try the demo credentials below.');
      }
    }, 700);
  };

  return (
    <div className="flex min-h-screen items-center justify-center overflow-x-clip bg-surface-50 px-4 py-10">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-surface-900">Nexus RFQ</p>
            <p className="text-xs leading-tight text-surface-400">RFQ → PO Platform</p>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-200 bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-surface-900">Welcome back</h1>
          <p className="mt-1 text-sm text-surface-500">
            Sign in to manage quotations, purchase orders and sales orders.
          </p>

          {formError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {formError}
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
            <div>
              <label htmlFor="login-email" className="label">Work email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@nexustrade.in"
                  className={classNames('input pl-9', errors.email && 'input-error')}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'login-email-error' : undefined}
                />
              </div>
              {errors.email && <p id="login-email-error" className="mt-1 text-xs font-medium text-rose-600">{errors.email}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="label">Password</label>
                <Link to="/forgot-password" className="mb-1.5 text-xs font-semibold text-brand-600 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className={classNames('input pl-9 pr-10', errors.password && 'input-error')}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p id="login-password-error" className="mt-1 text-xs font-medium text-rose-600">{errors.password}</p>}
            </div>

            <label className="flex items-center gap-2 text-sm text-surface-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40"
              />
              Remember me on this device
            </label>

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-[12px] text-brand-800">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>
              Demo login: <span className="font-semibold">{DEMO_EMAIL}</span> / <span className="font-semibold">{DEMO_PASSWORD}</span>
            </span>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-surface-400">Prototype build · v1.0 · Frontend demo</p>
      </div>
    </div>
  );
}
