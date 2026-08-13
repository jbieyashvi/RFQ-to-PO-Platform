import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Mail, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui';
import { classNames } from '@/lib/format';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter a valid work email address.');
      return;
    }
    setLoading(true);
    // Prototype only — no real email is sent.
    window.setTimeout(() => {
      setLoading(false);
      setSent(true);
    }, 700);
  };

  return (
    <div className="flex min-h-screen items-center justify-center overflow-x-clip bg-surface-50 px-4 py-10">
      <div className="w-full max-w-md">
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
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="text-lg font-bold text-surface-900">Check your inbox</h1>
              <p className="mt-2 text-sm text-surface-500">
                Password reset instructions have been sent to your email.
              </p>
              <p className="mt-1 text-xs text-surface-400">(Prototype — no real email is sent.)</p>
              <Link to="/login" className="mt-5 inline-flex">
                <Button variant="primary">
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold tracking-tight text-surface-900">Forgot password?</h1>
              <p className="mt-1 text-sm text-surface-500">
                Enter your work email and we’ll send you reset instructions.
              </p>

              <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
                <div>
                  <label htmlFor="reset-email" className="label">Work email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@nexustrade.in"
                      className={classNames('input pl-9', error && 'input-error')}
                      aria-invalid={!!error}
                    />
                  </div>
                  {error && <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>}
                </div>

                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </Button>
              </form>

              <Link to="/login" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
