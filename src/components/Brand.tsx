import { APP_NAME, APP_SUBTITLE, LOGO_SRC } from '@/lib/brand';

// Reusable Flowtech brand marks.
//
// The official logo is a white "FLOWTECH" wordmark with a red target mark, so
// it must sit on a dark backing panel to stay readable on the app's white
// sidebar / light login. We never recolour, stretch or crop the SVG — only
// scale it uniformly and place it on the Soft Dark Surface (#252525) panel.

/** Soft-dark backing panel that keeps the white wordmark readable on light UI. */
const DARK_PANEL = 'flex items-center justify-center rounded-lg bg-[#252525] shadow-sm';

/**
 * Full official Flowtech wordmark on a dark panel. Used where horizontal space
 * allows (expanded sidebar, login, document letterheads).
 */
export function FlowtechLogo({ className = 'h-9', imgClassName = 'h-4' }: { className?: string; imgClassName?: string }) {
  return (
    <div className={`${DARK_PANEL} px-2.5 ${className}`}>
      {/* aspect ratio preserved: width auto, height fixed */}
      <img src={LOGO_SRC} alt="Flowtech" className={`${imgClassName} w-auto`} />
    </div>
  );
}

/**
 * Compact monogram used where the full wordmark cannot fit (collapsed sidebar,
 * favicons, avatars). A red rounded square with a white "F".
 */
export function FlowtechMonogram({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <div className={`flex flex-none items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm ${className}`}>
      <svg viewBox="0 0 64 64" className="h-1/2 w-1/2" fill="none" aria-hidden="true">
        <path d="M22 17h22v8H31v7h11v8H31v15h-9V17z" fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * Sidebar / header brand lockup: monogram or full logo plus the app name and
 * platform subtitle. When `collapsed`, only the monogram renders.
 */
export function BrandLockup({ collapsed = false, useLogo = false }: { collapsed?: boolean; useLogo?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {useLogo && !collapsed ? <FlowtechLogo /> : <FlowtechMonogram />}
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-surface-800">{APP_NAME}</p>
          <p className="truncate text-[11px] text-surface-500">{APP_SUBTITLE}</p>
        </div>
      )}
    </div>
  );
}
