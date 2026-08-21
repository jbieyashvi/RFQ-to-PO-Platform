import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, Columns2, Layers, X } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementExtraction } from '@/lib/requirementExtraction';
import { MatrixStat, RequirementMatrixGrid } from '@/pages/inbox/RequirementMatrixGrid';
import { Button } from '@/components/ui';
import { useApp } from '@/context/AppContext';

/**
 * The requirement comparison matrix — every extracted line of one enquiry read
 * side by side, one column per line and one row per datasheet parameter.
 *
 * This is a REVIEW surface, not an editing one. A sales engineer quoting a
 * twelve-tag enquiry needs to see that eleven lines say "150#" and one says
 * nothing at all — a gap that is invisible when the lines are opened one at a
 * time. So nothing here is editable: every header and every value is a way back
 * into the single-item drawer, which is where a datasheet is actually changed.
 *
 * Because the drawer writes its edits to the email, and this matrix re-derives
 * from the email on every render, a correction made through it is already on
 * the matrix by the time the drawer closes — and survives closing the modal.
 *
 * The grid itself lives in RequirementMatrixGrid, shared with Compare with
 * Source, where the same columns are read against the document they came from.
 */

export function RequirementMatrixModal({
  email,
  extraction,
  focusId,
  blocked,
  onOpenItem,
  onCompareSource,
  onClose,
}: {
  email: InboxEmail;
  extraction: RequirementExtraction;
  /** Line the matrix was opened from — scrolled into view and ringed. */
  focusId: string | null;
  /** The detail drawer or the source comparison is open on top; leave Escape to it. */
  blocked: boolean;
  onOpenItem: (id: string) => void;
  /** Take the whole comparison across to the document it was read from. */
  onCompareSource: () => void;
  onClose: () => void;
}) {
  const { updateEmail, addToast } = useApp();
  const items = extraction.items;

  useEffect(() => {
    // Re-asserted whenever the drawer above closes, since the drawer clears the
    // lock on its own way out while this modal is still holding the screen.
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [blocked]);

  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blocked, onClose]);

  // Exactly the lines the summary strip counts as warnings: the ones waiting on
  // a human. Lines that already read as Confirmed have nothing to confirm, and
  // a line carrying a value that cannot be true has to be fixed in the drawer
  // first — so confirming in bulk can never wave an error past.
  const reviewable = useMemo(() => items.filter((it) => it.status === 'needs_review'), [items]);

  const confirmAll = () => {
    const confirmed = new Set(email.requirementConfirmed ?? []);
    reviewable.forEach((it) => confirmed.add(it.id));
    updateEmail(email.id, { requirementConfirmed: Array.from(confirmed) });

    const stillOpen = reviewable.reduce((n, it) => n + it.missingKeys.length, 0);
    addToast({
      type: 'success',
      title: `${reviewable.length} ${reviewable.length === 1 ? 'line' : 'lines'} confirmed`,
      message: stillOpen
        ? `${stillOpen} required ${stillOpen === 1 ? 'field is' : 'fields are'} still to be chased with the customer.`
        : 'Every confirmed line states the fields a quotation needs.',
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-surface-900/45 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Requirement comparison matrix"
        className="relative z-10 flex h-full w-full max-w-[1700px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        {/* Header + the five figures that decide whether this enquiry can be quoted. */}
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-100 px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-surface-800">
              <Layers className="h-4 w-4 flex-none text-brand-600" />
              Requirement comparison
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-surface-500">
              Every extracted line of “{email.subject}” read side by side.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Columns2 className="h-3.5 w-3.5" />}
              onClick={onCompareSource}
              title="Read this matrix against the document the enquiry arrived as"
            >
              Compare with Source
            </Button>
            <button
              onClick={onClose}
              aria-label="Close comparison"
              className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-stretch gap-2 border-b border-surface-100 bg-surface-50/70 px-5 py-2.5">
          <MatrixStat label="Line items" value={String(items.length)} />
          <MatrixStat label="Errors" value={String(extraction.errors)} tone={extraction.errors ? 'red' : 'idle'} />
          <MatrixStat label="Warnings" value={String(extraction.needsReview)} tone={extraction.needsReview ? 'amber' : 'idle'} />
          <MatrixStat
            label="Missing fields"
            value={String(extraction.missingTotal)}
            tone={extraction.missingTotal ? 'amber' : 'idle'}
          />
          <MatrixStat
            label="Overall accuracy"
            value={`${extraction.accuracy}%`}
            tone={extraction.state === 'error' ? 'red' : extraction.state === 'good' ? 'green' : 'amber'}
          />
        </div>

        <RequirementMatrixGrid items={items} focusId={focusId} onOpenItem={onOpenItem} />

        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-surface-50/60 px-5 py-3">
          <p className="text-[12px] text-surface-500">
            Click any item header or value to open its datasheet. Edits and confirmations are kept when this closes.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              leftIcon={<CheckCheck className="h-4 w-4" />}
              disabled={reviewable.length === 0}
              onClick={confirmAll}
            >
              Confirm All Reviewed Items
              {reviewable.length > 0 && ` (${reviewable.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
