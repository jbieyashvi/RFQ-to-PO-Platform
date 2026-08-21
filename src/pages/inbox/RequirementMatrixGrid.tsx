import { useEffect, useMemo, useRef } from 'react';
import { CircleAlert, Minus, PencilLine, TriangleAlert } from 'lucide-react';
import type { RequirementItem, RequirementStatus } from '@/lib/requirementExtraction';
import type { Domain, FieldSpec } from '@/lib/requirementFields';
import { MATRIX_BANDS, REQUIRED_FIELDS, fieldLabel } from '@/lib/requirementFields';
import { StatusBadge } from '@/components/ui';
import type { BadgeTone } from '@/lib/labels';
import { classNames } from '@/lib/format';

/**
 * The requirement matrix — every extracted line of one enquiry read side by
 * side, one column per line and one row per datasheet parameter, with the
 * parameter names sticky on the left and the item headers sticky on top.
 *
 * Shared by the two surfaces that need it, so they can never drift apart: the
 * View Details modal, where the matrix is the whole screen, and the right half
 * of Compare with Source, where it is read against the document it came from.
 *
 * Nothing here is editable. Every header and every value is a way back into the
 * single-item drawer, which is where a datasheet is actually changed — and
 * because the drawer writes to the email and this re-derives on every render, a
 * correction is on the matrix by the time the drawer closes.
 */

export const STATUS_META: Record<RequirementStatus, { label: string; tone: BadgeTone; column: string }> = {
  confirmed: { label: 'Confirmed', tone: 'green', column: 'border-t-emerald-400' },
  needs_review: { label: 'Needs Review', tone: 'amber', column: 'border-t-amber-400' },
  error: { label: 'Error', tone: 'red', column: 'border-t-rose-400' },
};

export function confidenceClass(confidence: number): string {
  if (confidence >= 80) return 'text-emerald-700';
  if (confidence >= 55) return 'text-amber-700';
  return 'text-rose-700';
}

export function MatrixStat({
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

interface GridProps {
  items: RequirementItem[];
  /** Line the matrix was opened from — scrolled into view and ringed. */
  focusId: string | null;
  onOpenItem: (id: string) => void;
  /**
   * Compare-with-source mode. Values are toned by the status of the line they
   * belong to — green where it reads confirmed, yellow where the reading is
   * weak, red where a required field is unstated or a stated one cannot be
   * true — and any value a human has since corrected is marked as a divergence
   * from the document on the left, which is the whole point of the pairing.
   */
  sourceMode?: boolean;
  /** Line the pointer is over, in either panel — kept in step across both. */
  hoverId?: string | null;
  onHoverItem?: (id: string | null) => void;
}

export function RequirementMatrixGrid({
  items,
  focusId,
  onOpenItem,
  sourceMode = false,
  hoverId = null,
  onHoverItem,
}: GridProps) {
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
    <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => onHoverItem?.(null)}>
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
                onMouseEnter={() => onHoverItem?.(item.id)}
                className={classNames(
                  COL,
                  'sticky top-0 z-20 border-b border-r border-surface-200 bg-white p-0 text-left align-top'
                )}
              >
                <ItemHeader
                  item={item}
                  focused={item.id === focusId}
                  hovered={item.id === hoverId}
                  onOpen={() => onOpenItem(item.id)}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {bands.map((band) => (
            <BandRows
              key={band.id}
              band={band}
              items={items}
              soleDomain={soleDomain}
              sourceMode={sourceMode}
              hoverId={hoverId}
              onHoverItem={onHoverItem}
              onOpenItem={onOpenItem}
            />
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
  sourceMode,
  hoverId,
  onHoverItem,
  onOpenItem,
}: {
  band: { id: string; title: string; fields: FieldSpec[] };
  items: RequirementItem[];
  soleDomain: Domain | null;
  sourceMode: boolean;
  hoverId: string | null;
  onHoverItem?: (id: string | null) => void;
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
              sourceMode={sourceMode}
              hovered={item.id === hoverId}
              onHover={() => onHoverItem?.(item.id)}
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
  hovered,
  onOpen,
}: {
  item: RequirementItem;
  focused: boolean;
  hovered: boolean;
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
        (focused || hovered) && 'bg-brand-50/70'
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
  sourceMode,
  hovered,
  onHover,
  onOpen,
}: {
  spec: FieldSpec;
  item: RequirementItem;
  striped: boolean;
  sourceMode: boolean;
  hovered: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const raw = (item.fields[spec.key] ?? '').trim();
  const error = item.invalid[spec.key];
  const required = REQUIRED_FIELDS[item.domain].includes(spec.key);
  const missing = raw === '' && required;

  // What the enquiry itself said here. A value that no longer matches it was
  // put right by a human, and the compare view says so rather than quietly
  // presenting a correction as something the customer sent.
  const source = (item.sourceFields[spec.key] ?? '').trim();
  const corrected = sourceMode && source !== raw;

  // Beside the document, a value is read as part of its line: green where the
  // line is confirmed, yellow where the reading is still weak. Unstated
  // required fields turn red here — against the source, a blank the customer
  // never filled in is the gap, not a shade of caution.
  const statedTone = !sourceMode
    ? classNames(striped ? 'bg-surface-50' : 'bg-white', 'text-surface-800 hover:bg-brand-50/50')
    : item.status === 'confirmed'
    ? 'bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/70'
    : item.status === 'needs_review'
    ? 'bg-amber-50/60 text-amber-800 hover:bg-amber-100/60'
    : classNames(striped ? 'bg-surface-50' : 'bg-white', 'text-surface-800 hover:bg-brand-50/50');

  const tone = error
    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
    : missing
    ? sourceMode
      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
    : statedTone;

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
      onMouseEnter={onHover}
      title={
        corrected
          ? `Corrected here — the enquiry stated ${source ? `“${source}”` : 'nothing'}`
          : undefined
      }
      className={classNames(
        COL,
        'cursor-pointer border-b border-r border-surface-200 px-3 py-1.5 align-top transition-colors',
        tone,
        corrected && 'border-l-2 border-l-brand-400',
        hovered && 'ring-1 ring-inset ring-brand-200'
      )}
    >
      <div className="flex items-start gap-1">
        <div className="line-clamp-2 min-w-0 flex-1 break-words">{body}</div>
        {corrected && <PencilLine className="mt-px h-3 w-3 flex-none text-brand-500" aria-label="Corrected" />}
      </div>
    </td>
  );
}
