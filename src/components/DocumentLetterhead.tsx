import { FlowtechLogo } from './Brand';
import { COMPANY_ADDRESS, COMPANY_NAME } from '@/lib/brand';

/**
 * Flowtech document letterhead for generated quotation / sales-order previews
 * and PDFs. Clean white surface, charcoal company identity and a restrained
 * brand-red rule + document title — an operational document, not a marketing
 * page. The official logo sits on its dark panel so the white wordmark stays
 * readable without recolouring the asset.
 */
export function DocumentLetterhead({ docTitle, meta }: { docTitle: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-brand-600 pb-3">
      <div className="flex items-start gap-3">
        <FlowtechLogo className="h-10" imgClassName="h-5" />
        <div className="min-w-0">
          <p className="text-[13px] font-bold leading-tight text-surface-900">{COMPANY_NAME}</p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-surface-500">{COMPANY_ADDRESS.line1}</p>
          <p className="text-[10.5px] leading-snug text-surface-500">{COMPANY_ADDRESS.line2}</p>
          <p className="mt-0.5 text-[10.5px] leading-snug text-surface-500">
            GSTIN {COMPANY_ADDRESS.gstin} · PAN {COMPANY_ADDRESS.pan}
          </p>
        </div>
      </div>
      <div className="flex-none text-right">
        <p className="text-[13px] font-bold uppercase tracking-[0.04em] text-brand-700">{docTitle}</p>
        {meta && <div className="mt-1 text-[11px] text-surface-500">{meta}</div>}
      </div>
    </div>
  );
}
