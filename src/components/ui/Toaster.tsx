import { createPortal } from 'react-dom';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useApp, type ToastType } from '@/context/AppContext';

const config: Record<ToastType, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200', iconColor: 'text-emerald-500' },
  error: { icon: XCircle, ring: 'border-rose-200', iconColor: 'text-rose-500' },
  warning: { icon: AlertTriangle, ring: 'border-amber-200', iconColor: 'text-amber-500' },
  info: { icon: Info, ring: 'border-blue-200', iconColor: 'text-blue-500' },
};

export function Toaster() {
  const { toasts, dismissToast } = useApp();

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const c = config[t.type];
        const Icon = c.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-pop animate-slide-up ${c.ring}`}
          >
            <Icon className={`mt-0.5 h-5 w-5 flex-none ${c.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-surface-800">{t.title}</p>
              {t.message && <p className="mt-0.5 text-sm text-surface-500">{t.message}</p>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="rounded p-0.5 text-surface-400 hover:bg-surface-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
