import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Columns2, GripVertical, PencilLine, X } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementExtraction } from '@/lib/requirementExtraction';
import { RequirementMatrixGrid } from '@/pages/inbox/RequirementMatrixGrid';
import { SourceDocumentViewer } from '@/pages/inbox/SourceDocumentViewer';
import { Button } from '@/components/ui';
import { classNames } from '@/lib/format';

/**
 * Compare with Source — the enquiry as it arrived on the left, everything the
 * AI made of it on the right, on one screen.
 *
 * The extraction workspace and the comparison matrix both answer "is this
 * reading complete". Neither answers "is it RIGHT", because nothing in them
 * shows the page the value was read off. Here a suspect figure can be checked
 * against the customer's own sheet without leaving the review, and a value a
 * human has already corrected is marked as a divergence rather than passed off
 * as something the customer sent.
 *
 * Both halves stay in step: the pointer over a line in either panel lights it
 * in the other, and clicking anywhere on it opens the single-item drawer. The
 * drawer writes to the email and both panels re-derive, so a saved datasheet
 * moves the matrix and the accuracy score the moment it closes — while the
 * document, which prints the untouched reading, stays exactly as it arrived.
 */

const HANDLE_W = 9;
const MIN_SPLIT = 25;
const MAX_SPLIT = 75;

export function RequirementCompareModal({
  email,
  extraction,
  focusId,
  blocked,
  /** True when the comparison matrix is open underneath — Back returns to it. */
  fromMatrix,
  onOpenItem,
  onBack,
  onClose,
}: {
  email: InboxEmail;
  extraction: RequirementExtraction;
  focusId: string | null;
  /** The detail drawer is open on top; leave Escape and the overlay to it. */
  blocked: boolean;
  fromMatrix: boolean;
  onOpenItem: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [split, setSplit] = useState(50);
  // The line the pointer is on, in either panel. Held here because it is the
  // one piece of state the two halves genuinely share.
  const [hoverId, setHoverId] = useState<string | null>(null);

  const shell = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    // Re-asserted whenever the drawer above closes, since the drawer clears the
    // lock on its own way out while this view is still holding the screen.
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [blocked]);

  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blocked, onBack]);

  const moveTo = (clientX: number) => {
    const rect = shell.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)));
  };

  const accuracyTone =
    extraction.state === 'error' ? 'text-rose-700' : extraction.state === 'good' ? 'text-emerald-700' : 'text-amber-700';

  return createPortal(
    <div className="fixed inset-0 z-[45] flex items-stretch justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-[1px] animate-fade-in" onClick={onBack} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare extraction with source document"
        className="relative z-10 flex h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-100 px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-surface-800">
              <Columns2 className="h-4 w-4 flex-none text-brand-600" />
              Compare with source
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-surface-500">
              What the customer sent, against what the AI read from it — “{email.subject}”.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close comparison"
            className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={shell} className="flex min-h-0 flex-1">
          <div style={{ width: `${split}%` }} className="min-w-0 flex-none border-r border-surface-200">
            <SourceDocumentViewer
              email={email}
              extraction={extraction}
              focusId={focusId}
              hoverId={hoverId}
              onHoverItem={setHoverId}
              onOpenItem={onOpenItem}
            />
          </div>

          {/* The divider. Draggable with the pointer, nudgeable from the
              keyboard, so neither half is ever stuck at half the screen. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            aria-valuenow={Math.round(split)}
            aria-valuemin={MIN_SPLIT}
            aria-valuemax={MAX_SPLIT}
            tabIndex={0}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
            onPointerUp={(e) => {
              dragging.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onDoubleClick={() => setSplit(50)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setSplit((s) => Math.max(MIN_SPLIT, s - 4));
              if (e.key === 'ArrowRight') setSplit((s) => Math.min(MAX_SPLIT, s + 4));
            }}
            style={{ width: HANDLE_W }}
            className="group flex flex-none cursor-col-resize touch-none items-center justify-center bg-surface-100 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:bg-brand-100"
            title="Drag to resize · double-click to even up"
          >
            <GripVertical className="h-4 w-4 text-surface-400 transition-colors group-hover:text-brand-600" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* The score the comparison is checking, and the counts behind it.
                Both re-derive from the email, so saving a line moves them here
                the moment the drawer closes. */}
            <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-surface-100 bg-surface-50/70 px-4 py-2">
              <div className="flex items-baseline gap-2">
                <span className={classNames('text-[20px] font-semibold leading-none tabular-nums', accuracyTone)}>
                  {extraction.accuracy}%
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                  Overall accuracy
                </span>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-surface-600">
                <span className="font-medium text-surface-700">
                  {extraction.items.length} {extraction.items.length === 1 ? 'line' : 'lines'}
                </span>
                <span aria-hidden>·</span>
                <span className={extraction.confirmed ? 'text-emerald-700' : undefined}>
                  {extraction.confirmed} confirmed
                </span>
                <span aria-hidden>·</span>
                <span className={extraction.needsReview ? 'text-amber-700' : undefined}>
                  {extraction.needsReview} low confidence
                </span>
                <span aria-hidden>·</span>
                <span className={extraction.errors ? 'font-semibold text-rose-700' : undefined}>
                  {extraction.errors} {extraction.errors === 1 ? 'error' : 'errors'}
                </span>
                <span aria-hidden>·</span>
                <span className={extraction.missingTotal ? 'text-rose-700' : undefined}>
                  {extraction.missingTotal} missing {extraction.missingTotal === 1 ? 'field' : 'fields'}
                </span>
              </p>
            </div>

            <RequirementMatrixGrid
              items={extraction.items}
              focusId={focusId}
              sourceMode
              hoverId={hoverId}
              onHoverItem={setHoverId}
              onOpenItem={onOpenItem}
            />
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-surface-50/60 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-surface-500">
            <Swatch className="bg-emerald-100 ring-emerald-300" label="Confirmed" />
            <Swatch className="bg-amber-100 ring-amber-300" label="Low confidence" />
            <Swatch className="bg-rose-100 ring-rose-300" label="Missing or invalid" />
            <span className="flex items-center gap-1">
              <PencilLine className="h-3 w-3 text-brand-500" />
              Corrected since it arrived
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>
              {fromMatrix ? 'Back to Comparison' : 'Back to Extraction'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={classNames('h-2.5 w-2.5 rounded-sm ring-1', className)} />
      {label}
    </span>
  );
}
