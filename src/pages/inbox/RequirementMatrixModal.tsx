import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, CircleAlert, Layers, Minus, TriangleAlert, X } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementExtraction, RequirementItem, RequirementStatus } from '@/lib/requirementExtraction';
import type { Domain, FieldSpec } from '@/lib/requirementFields';
import { MATRIX_BANDS, REQUIRED_FIELDS, fieldLabel } from '@/lib/requirementFields';
import { Button, StatusBadge } from '@/components/ui';
import type { BadgeTone } from '@/lib/labels';
import { classNames } from '@/lib/format';
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
 */

const STATUS_META: Record<RequirementStatus, { label: string; tone: BadgeTone; column: string }> = {
  confirmed: { label: 'Confirmed', tone: 'green', column: 'border-t-emerald-400' },
  needs_review: { label: 'Needs Review', tone: 'amber', column: 'border-t-amber-400' },
  error: { label: 'Error', tone: 'red', column: 'border-t-rose-400' },
};

function confidenceClass(confidence: number): string {
  if (confidence >= 80) return 'text-emerald-700';
  if (confidence >= 55) return 'text-amber-700';
  return 'text-rose-700';
}

export function RequirementMatrixModal({
  email,
  extraction,
  focusId,
  blocked,
  onOpenItem,
  onClose,
}: {
  email: InboxEmail;
  extraction: RequirementExtraction;
  /** Line the matrix was opened from — scrolled into view and ringed. */
  focusId: string | null;
  /** The detail drawer is open on top; leave Escape and the overlay to it. */
  blocked: boolean;
  onOpenItem: (id: string) => void;
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
          <button
            onClick={onClose}
            aria-label="Close comparison"
            className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-none flex-wrap items-stretch gap-2 border-b border-surface-100 bg-surface-50/70 px-5 py-2.5">
          <Stat label="Line items" value={String(items.length)} />
          <Stat label="Errors" value={String(extraction.errors)} tone={extraction.errors ? 'red' : 'idle'} />
          <Stat label="Warnings" value={String(extraction.needsReview)} tone={extraction.needsReview ? 'amber' : 'idle'} />
          <Stat
            label="Missing fields"
            value={String(extraction.missingTotal)}
            tone={extraction.missingTotal ? 'amber' : 'idle'}
          />
          <Stat
            label="Overall accuracy"
            value={`${extraction.accuracy}%`}
            tone={extraction.state === 'error' ? 'red' : extraction.state === 'good' ? 'green' : 'amber'}
          />
        </div>

        <MatrixGrid items={items} focusId={focusId} onOpenItem={onOpenItem} />

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

function Stat({
  label,
  value,
  tone = 'idle',
}: {
  label: string;
  value: string;
  tone?: 'idle' | 'green' | 'amber' | 'red';
}) {
  const toneClass = {
    idle: 'border-surface-200 bg-white text-surface-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-rose-200 bg-rose-50 text-rose-700',
  }[tone];

  return (
    <div className={classNames('min-w-[124px] flex-1 rounded-xl border px-3 py-1.5', toneClass)}>
      <p className="text-[19px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

const COL = 'w-[236px] min-w-[236px] max-w-[236px]';
const NAME_COL = 'w-[268px] min-w-[268px] max-w-[268px]';

function MatrixGrid({
  items,
  focusId,
  onOpenItem,
}: {
  items: RequirementItem[];
  focusId: string | null;
  onOpenItem: (id: string) => void;
}) {
  const focusCell = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    // Opened from one line's View Details — start on that column rather than
    // making the engineer hunt for line 9 among twelve.
    focusCell.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [focusId]);

  // Every domain in play, so a row's name can use the datasheet term when the
  // lines agree on one, and stay generic when the enquiry mixes kinds of line.
  const domains = useMemo(() => Array.from(new Set(items.map((it) => it.domain))), [items]);
  const soleDomain: Domain | null = domains.length === 1 ? domains[0] : null;

  /**
   * A row earns its place if any line states a value for it, or if any line's
   * datasheet REQUIRES it — an unstated required field is exactly what the
   * matrix is for. Everything else (viscosity across four MCCBs) is dropped, so
   * the rows that remain are all worth reading.
   */
  const rowVisible = (spec: FieldSpec) =>
    items.some(
      (it) => (it.fields[spec.key] ?? '').trim() !== '' || REQUIRED_FIELDS[it.domain].includes(spec.key)
    );

  const bands = useMemo(
    () =>
      MATRIX_BANDS.map((band) => ({ ...band, fields: band.fields.filter(rowVisible) })).filter(
        (band) => band.fields.length > 0
      ),
    [items]
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th
              scope="col"
              className={classNames(
                NAME_COL,
                'sticky left-0 top-0 z-30 border-b border-r border-surface-200 bg-white px-3 py-2 text-left align-bottom'
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Parameter</span>
            </th>
            {items.map((item) => (
              <th
                key={item.id}
                scope="col"
                ref={item.id === focusId ? focusCell : undefined}
                className={classNames(
                  COL,
                  'sticky top-0 z-20 border-b border-r border-surface-200 bg-white p-0 text-left align-top'
                )}
              >
                <ItemHeader item={item} focused={item.id === focusId} onOpen={() => onOpenItem(item.id)} />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {bands.map((band) => (
            <BandRows key={band.id} band={band} items={items} soleDomain={soleDomain} onOpenItem={onOpenItem} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BandRows({
  band,
  items,
  soleDomain,
  onOpenItem,
}: {
  band: { id: string; title: string; fields: FieldSpec[] };
  items: RequirementItem[];
  soleDomain: Domain | null;
  onOpenItem: (id: string) => void;
}) {
  return (
    <>
      <tr>
        <th
          scope="rowgroup"
          className={classNames(
            NAME_COL,
            'sticky left-0 z-10 border-b border-r border-surface-200 bg-brand-50 px-3 py-1.5 text-left'
          )}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{band.title}</span>
        </th>
        <td colSpan={items.length} className="border-b border-surface-200 bg-brand-50" />
      </tr>

      {band.fields.map((spec, i) => (
        <tr key={spec.key}>
          <th
            scope="row"
            title={spec.label}
            className={classNames(
              NAME_COL,
              'sticky left-0 z-10 border-b border-r border-surface-200 px-3 py-1.5 text-left align-top font-medium text-surface-600',
              i % 2 ? 'bg-surface-50' : 'bg-white'
            )}
          >
            {soleDomain ? fieldLabel(spec, soleDomain) : spec.label}
          </th>
          {items.map((item) => (
            <ValueCell
              key={item.id}
              spec={spec}
              item={item}
              striped={i % 2 === 1}
              onOpen={() => onOpenItem(item.id)}
            />
          ))}
        </tr>
      ))}
    </>
  );
}

function ItemHeader({
  item,
  focused,
  onOpen,
}: {
  item: RequirementItem;
  focused: boolean;
  onOpen: () => void;
}) {
  const status = STATUS_META[item.status];

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.name} — open datasheet`}
      className={classNames(
        'block h-full w-full border-t-[3px] px-3 pb-2 pt-1.5 text-left transition-colors hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300',
        status.column,
        focused && 'bg-brand-50/70'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 flex-none items-center justify-center rounded bg-surface-100 text-[10px] font-semibold tabular-nums text-surface-600">
          {item.lineNo}
        </span>
        <span className="truncate text-[12px] font-semibold text-surface-900">{item.tag}</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-surface-500" title={item.name}>
        {item.name}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-surface-500">
          Qty{' '}
          <span className={classNames('font-semibold', item.quantity === null ? 'text-rose-700' : 'text-surface-800')}>
            {item.quantity === null ? '—' : `${item.quantity} ${item.unit}`}
          </span>
        </span>
        <span className={classNames('font-semibold tabular-nums', confidenceClass(item.confidence))}>
          {item.confidence}%
        </span>
        <span className={item.missingKeys.length ? 'font-semibold text-amber-700' : 'text-surface-400'}>
          {item.missingKeys.length} missing
        </span>
      </div>

      <StatusBadge tone={status.tone} label={status.label} className="mt-1.5" />
    </button>
  );
}

/** The unit a value is quoted in — fixed, or taken from this line's own units. */
function unitOf(spec: FieldSpec, fields: Record<string, string>): string {
  if (spec.unit) return spec.unit;
  return spec.unitFrom ? (fields[spec.unitFrom] ?? '').trim() : '';
}

function ValueCell({
  spec,
  item,
  striped,
  onOpen,
}: {
  spec: FieldSpec;
  item: RequirementItem;
  striped: boolean;
  onOpen: () => void;
}) {
  const raw = (item.fields[spec.key] ?? '').trim();
  const error = item.invalid[spec.key];
  const required = REQUIRED_FIELDS[item.domain].includes(spec.key);
  const missing = raw === '' && required;

  const tone = error
    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
    : missing
    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
    : classNames(striped ? 'bg-surface-50' : 'bg-white', 'text-surface-800 hover:bg-brand-50/50');

  let body;
  if (error) {
    body = (
      <span className="flex items-start gap-1" title={error}>
        <CircleAlert className="mt-px h-3 w-3 flex-none" />
        <span className="min-w-0 font-semibold">{raw || 'Not stated'}</span>
      </span>
    );
  } else if (missing) {
    body = (
      <span className="flex items-center gap-1" title="Required for a quotation — not stated in the enquiry">
        <TriangleAlert className="h-3 w-3 flex-none" />
        <span className="font-semibold">Not stated</span>
      </span>
    );
  } else if (raw === '') {
    // Blank and not required — either the enquiry was silent or the field does
    // not apply to this kind of line. Neither is a fault, so neither shouts.
    body = <Minus className="h-3 w-3 text-surface-300" aria-label="Not applicable" />;
  } else {
    const unit = spec.kind === 'toggle' ? '' : unitOf(spec, item.fields);
    const text = spec.kind === 'toggle' ? (raw === 'yes' ? 'Yes' : 'No') : raw;
    body = (
      <span title={`${text}${unit ? ` ${unit}` : ''}`}>
        {text}
        {unit && <span className="ml-1 text-surface-400">{unit}</span>}
      </span>
    );
  }

  return (
    <td
      onClick={onOpen}
      className={classNames(
        COL,
        'cursor-pointer border-b border-r border-surface-200 px-3 py-1.5 align-top transition-colors',
        tone
      )}
    >
      <div className="line-clamp-2 break-words">{body}</div>
    </td>
  );
}
