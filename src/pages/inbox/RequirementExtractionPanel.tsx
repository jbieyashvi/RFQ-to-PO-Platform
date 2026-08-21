import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Columns2, Columns3, ListChecks, OctagonAlert, Tag } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementItem, RequirementStatus } from '@/lib/requirementExtraction';
import { requirementExtraction } from '@/lib/requirementExtraction';
import { RequirementDetailDrawer } from '@/pages/inbox/RequirementDetailDrawer';
import { RequirementMatrixModal } from '@/pages/inbox/RequirementMatrixModal';
import { RequirementCompareModal } from '@/pages/inbox/RequirementCompareModal';
import { StatusBadge } from '@/components/ui';
import { classNames } from '@/lib/format';
import { useApp } from '@/context/AppContext';
import type { BadgeTone } from '@/lib/labels';

/**
 * AI Requirement Extraction — the line-level reading of an inquiry, shown in the
 * inbox's right workspace whenever an Inquiry email is open.
 *
 * The header answers "can I trust this reading at all" with one Overall Accuracy
 * score; the scrollable cards below answer it per line, so an incomplete or
 * low-confidence instrument is visible without opening anything.
 *
 * Three ways deeper, because there are three questions. Clicking a card opens
 * that line's datasheet in the detail drawer — the place a gap is actually
 * filled in. View Details opens the comparison matrix, where every line of the
 * enquiry is read side by side, which is the only way to see that one tag out of
 * twelve was never given a flange rating. Compare with Source sets that same
 * matrix beside the document the enquiry arrived as, which is the only way to
 * see that a figure was read off the wrong row.
 */

const STATUS_META: Record<RequirementStatus, { label: string; tone: BadgeTone }> = {
  confirmed: { label: 'Confirmed', tone: 'green' },
  needs_review: { label: 'Needs Review', tone: 'amber' },
  error: { label: 'Error', tone: 'red' },
};

const SCORE_META = {
  good: {
    label: 'Extraction reads reliably',
    ring: 'border-emerald-200 bg-emerald-50',
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  },
  review: {
    label: 'Below 80% — review before quoting',
    ring: 'border-amber-200 bg-amber-50',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
    icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  },
  error: {
    label: 'Extraction errors — lines could not be read',
    ring: 'border-rose-200 bg-rose-50',
    text: 'text-rose-700',
    bar: 'bg-rose-500',
    icon: <OctagonAlert className="h-4 w-4 text-rose-600" />,
  },
} as const;

function confidenceClass(confidence: number): string {
  if (confidence >= 80) return 'text-emerald-700';
  if (confidence >= 55) return 'text-amber-700';
  return 'text-rose-700';
}

export function RequirementExtractionPanel({ email }: { email: InboxEmail }) {
  const { quotations, salesOrders } = useApp();
  const [activeId, setActiveId] = useState<string | null>(null);
  // The comparison matrix, and the line it was opened from. Held separately
  // from `activeId` because the drawer opens ON TOP of the matrix: correcting a
  // line found by comparison should hand you straight back to the comparison.
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixFocusId, setMatrixFocusId] = useState<string | null>(null);
  // The source comparison, which can be reached either straight from here or
  // from the matrix. When it was opened from the matrix the matrix stays
  // mounted underneath, so Back hands the review straight back to it.
  const [compareOpen, setCompareOpen] = useState(false);

  const extraction = requirementExtraction(email, quotations, salesOrders);
  // Looked up rather than held: the open line is re-derived on every render, so
  // a datasheet saved in the drawer is reflected by the drawer itself as well as
  // by the card behind it.
  const activeItem = extraction?.items.find((it) => it.id === activeId) ?? null;

  const openMatrix = (focus: string | null) => {
    setMatrixFocusId(focus);
    setMatrixOpen(true);
  };

  const openCompare = (focus: string | null) => {
    setMatrixFocusId(focus);
    setCompareOpen(true);
  };

  const closeAll = () => {
    setCompareOpen(false);
    setMatrixOpen(false);
  };

  if (!extraction) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader />
        <div className="min-h-0 flex-1 px-4 py-5 text-center text-[12px] text-surface-500">
          No itemised requirement was extracted from this enquiry.
        </div>
      </div>
    );
  }

  const meta = SCORE_META[extraction.state];
  // The score measures how well the enquiry READ; open lines are a separate
  // fact, so a reliable read with lines still to chase says both.
  const headline =
    extraction.state === 'good' && extraction.needsReview > 0
      ? `${meta.label} — ${extraction.needsReview} ${extraction.needsReview === 1 ? 'line still needs' : 'lines still need'} review`
      : meta.label;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />

      {/* Overall accuracy — the one number that gates the whole reading. */}
      <div className="flex-none px-3 pt-2.5">
        <div className={classNames('rounded-xl border p-3', meta.ring)}>
          {/* The two source controls wrap under the score rather than being
              clipped when the workspace column is at its narrowest. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className={classNames('text-[20px] font-semibold leading-none tabular-nums', meta.text)}>
                {extraction.accuracy}%
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                Overall Accuracy
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => openCompare(null)}
                title="Read the extraction against the document the enquiry arrived as"
                className="inline-flex flex-none items-center gap-1 rounded-lg border border-surface-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:border-brand-200 hover:bg-brand-50"
              >
                <Columns2 className="h-3 w-3" /> Compare with Source
              </button>
              <button
                type="button"
                onClick={() => openMatrix(null)}
                className="inline-flex flex-none items-center gap-1 rounded-lg border border-surface-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:border-brand-200 hover:bg-brand-50"
              >
                <Columns3 className="h-3 w-3" /> View Details
              </button>
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
            <div className={classNames('h-full rounded-full', meta.bar)} style={{ width: `${extraction.accuracy}%` }} />
          </div>
          <p className={classNames('mt-2 flex items-start gap-1.5 text-[12px] font-medium', meta.text)}>
            <span className="mt-px flex-none">{meta.icon}</span>
            {headline}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-surface-600">
            <span className="font-medium text-surface-700">
              {extraction.items.length} {extraction.items.length === 1 ? 'line' : 'lines'}
            </span>
            <span aria-hidden>·</span>
            <span>{extraction.confirmed} confirmed</span>
            <span aria-hidden>·</span>
            <span className={extraction.needsReview ? 'text-amber-700' : undefined}>
              {extraction.needsReview} {extraction.needsReview === 1 ? 'needs' : 'need'} review
            </span>
            <span aria-hidden>·</span>
            <span className={extraction.errors ? 'font-semibold text-rose-700' : undefined}>
              {extraction.errors} {extraction.errors === 1 ? 'error' : 'errors'}
            </span>
            <span aria-hidden>·</span>
            <span className={extraction.missingTotal ? 'text-amber-700' : undefined}>
              {extraction.missingTotal} missing {extraction.missingTotal === 1 ? 'field' : 'fields'}
            </span>
          </p>
        </div>
      </div>

      {/* Line items — compact cards, scrolled independently of the header. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div className="space-y-2">
          {extraction.items.map((item) => (
            <RequirementCard
              key={item.id}
              item={item}
              active={activeId === item.id}
              onOpen={() => setActiveId(item.id)}
              onCompare={() => openMatrix(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Both overlay the inbox — the mail behind them stays open. Edits live on
          the email, so closing either keeps every correction and confirmation. */}
      {matrixOpen && (
        <RequirementMatrixModal
          email={email}
          extraction={extraction}
          focusId={matrixFocusId}
          blocked={activeId !== null || compareOpen}
          onOpenItem={setActiveId}
          onCompareSource={() => setCompareOpen(true)}
          onClose={() => setMatrixOpen(false)}
        />
      )}
      {compareOpen && (
        <RequirementCompareModal
          email={email}
          extraction={extraction}
          focusId={matrixFocusId}
          blocked={activeId !== null}
          fromMatrix={matrixOpen}
          onOpenItem={setActiveId}
          onBack={() => setCompareOpen(false)}
          onClose={closeAll}
        />
      )}
      {activeItem && (
        <RequirementDetailDrawer
          key={activeItem.id}
          email={email}
          item={activeItem}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-surface-100 px-3 py-2">
      <ListChecks className="h-4 w-4 flex-none text-brand-600" />
      <h2 className="text-[14px] font-semibold text-surface-800">AI Requirement Extraction</h2>
    </div>
  );
}

function RequirementCard({
  item,
  active,
  onOpen,
  onCompare,
}: {
  item: RequirementItem;
  active: boolean;
  onOpen: () => void;
  onCompare: () => void;
}) {
  const status = STATUS_META[item.status];
  // Low confidence and unstated datasheet fields are the two things that stop a
  // line being quotable, so the card carries the tint rather than hiding it in
  // the badge alone.
  const tint =
    item.status === 'error'
      ? 'border-rose-200 bg-rose-50/60 hover:border-rose-300'
      : item.status === 'needs_review'
      ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300'
      : 'border-surface-200 bg-white hover:border-brand-200';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Line ${item.lineNo} — ${item.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={classNames(
        'cursor-pointer rounded-xl border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
        tint,
        active && 'ring-2 ring-brand-300'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md bg-surface-100 text-[11px] font-semibold tabular-nums text-surface-600">
          {item.lineNo}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-surface-900" title={item.name}>
            {item.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-surface-500">
            <Tag className="h-3 w-3 flex-none" />
            <span className="font-medium text-surface-700">{item.tag}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{item.service}</span>
          </p>
        </div>
        <StatusBadge tone={status.tone} label={status.label} className="flex-none" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-surface-500">
          Qty{' '}
          <span className={classNames('font-semibold', item.quantity === null ? 'text-rose-700' : 'text-surface-800')}>
            {item.quantity === null ? 'Not readable' : `${item.quantity} ${item.unit}`}
          </span>
        </span>
        <span className="text-surface-500">
          Confidence <span className={classNames('font-semibold tabular-nums', confidenceClass(item.confidence))}>{item.confidence}%</span>
        </span>
        <span className={classNames(item.missingFields.length ? 'font-semibold text-amber-700' : 'text-surface-500')}>
          {item.missingFields.length} missing {item.missingFields.length === 1 ? 'field' : 'fields'}
        </span>
      </div>

      {item.errorNote && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-rose-700">
          <OctagonAlert className="mt-px h-3 w-3 flex-none" />
          <span className="min-w-0">{item.errorNote}</span>
        </p>
      )}
      {!item.errorNote && item.missingFields.length > 0 && (
        <p className="mt-1.5 truncate text-[11px] text-amber-700" title={item.missingFields.join(', ')}>
          Missing: {item.missingFields.join(', ')}
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          title="Compare every line of this enquiry, starting here"
          onClick={(e) => {
            e.stopPropagation();
            onCompare();
          }}
          className="inline-flex items-center gap-0.5 rounded-lg border border-surface-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:border-brand-200 hover:bg-brand-50"
        >
          View Details <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
