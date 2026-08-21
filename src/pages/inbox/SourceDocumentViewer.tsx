import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Maximize2, Paperclip, ZoomIn, ZoomOut } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementExtraction, RequirementItem } from '@/lib/requirementExtraction';
import type { SourceDocument } from '@/lib/sourceDocuments';
import { docDate, enquiryRef, pageLabel, sourceDocuments } from '@/lib/sourceDocuments';
import { MATRIX_BANDS, REQUIRED_FIELDS, fieldLabel } from '@/lib/requirementFields';
import { COMPANY } from '@/lib/company';
import { classNames, formatDateTime } from '@/lib/format';

/**
 * The left half of Compare with Source — the enquiry as the customer sent it,
 * rendered as printed sheets and driven like a PDF viewer.
 *
 * Every line on these pages prints `item.sourceFields`, the reading before any
 * human touched it, so the document stays exactly as it arrived while the
 * matrix beside it moves with each correction. A field the enquiry never filled
 * in is printed as an empty rule rather than dropped — the gap is the thing
 * being looked for, and on paper it looks like a gap.
 */

/** A4 at 96 dpi. The sheets are a fixed width; zoom scales them, as in a viewer. */
const PAGE_W = 794;
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function SourceDocumentViewer({
  email,
  extraction,
  focusId,
  hoverId,
  onHoverItem,
  onOpenItem,
}: {
  email: InboxEmail;
  extraction: RequirementExtraction;
  /** Line the compare view was opened on — scrolled to in the document too. */
  focusId: string | null;
  hoverId: string | null;
  onHoverItem: (id: string | null) => void;
  onOpenItem: (id: string) => void;
}) {
  const docs = sourceDocuments(email, extraction);
  const [activeId, setActiveId] = useState(docs[0].id);
  const doc = docs.find((d) => d.id === activeId) ?? docs[0];

  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // Fit-to-width is a MODE, not a one-off: once chosen the sheet keeps filling
  // the pane as the divider is dragged, which is the only reason to choose it.
  const [fit, setFit] = useState(true);

  const fitZoom = useCallback(() => {
    const el = scroller.current;
    if (!el) return 1;
    // 32px of gutter each side, and room for the scrollbar the pages will need.
    const usable = el.clientWidth - 64;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, usable / PAGE_W));
  }, []);

  useLayoutEffect(() => {
    if (!fit) return;
    const el = scroller.current;
    if (!el) return;
    const apply = () => setZoom(fitZoom());
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, fitZoom]);

  const step = (dir: 1 | -1) => {
    setFit(false);
    setZoom((z) => {
      const i = ZOOM_STEPS.findIndex((s) => (dir > 0 ? s > z + 0.001 : s >= z - 0.001));
      if (dir > 0) return i === -1 ? MAX_ZOOM : ZOOM_STEPS[i];
      return i <= 0 ? MIN_ZOOM : ZOOM_STEPS[i - 1];
    });
  };

  // Opened on one line — bring it up in the document as well as in the matrix,
  // so both halves start on the same line instead of on page one.
  useEffect(() => {
    if (!focusId) return;
    const el = scroller.current?.querySelector(`[data-item-id="${focusId}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [focusId, doc.id]);

  const items = extraction.items;

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-100">
      {/* Compact document tabs — only when the enquiry actually carried more
          than one document; a single-document enquiry gets no chrome. */}
      {docs.length > 1 && (
        <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-surface-200 bg-white px-2 pt-1.5">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              title={d.fileName}
              className={classNames(
                'flex flex-none items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                d.id === doc.id
                  ? 'border-surface-200 bg-white text-brand-700'
                  : 'border-transparent bg-surface-50 text-surface-500 hover:bg-surface-100 hover:text-surface-700'
              )}
            >
              <Paperclip className="h-3 w-3 flex-none" />
              <span className="max-w-[150px] truncate">{d.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-surface-200 bg-white px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 flex-none text-brand-600" />
          <span className="truncate text-[12px] font-semibold text-surface-800" title={doc.fileName}>
            {doc.fileName}
          </span>
          <span className="flex-none text-[11px] text-surface-400">{pageLabel(doc)}</span>
        </div>

        <div className="flex flex-none items-center gap-0.5">
          <ZoomButton label="Zoom out" onClick={() => step(-1)} disabled={zoom <= MIN_ZOOM + 0.001}>
            <ZoomOut className="h-3.5 w-3.5" />
          </ZoomButton>
          <span className="w-11 text-center text-[11px] font-semibold tabular-nums text-surface-600">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton label="Zoom in" onClick={() => step(1)} disabled={zoom >= MAX_ZOOM - 0.001}>
            <ZoomIn className="h-3.5 w-3.5" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => setFit(true)}
            title="Fit to width"
            className={classNames(
              'ml-1 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors',
              fit
                ? 'border-brand-200 bg-brand-50 text-brand-700'
                : 'border-surface-200 bg-white text-surface-600 hover:border-brand-200 hover:text-brand-700'
            )}
          >
            <Maximize2 className="h-3 w-3" /> Fit
          </button>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-8 py-5">
        <div className="mx-auto w-max space-y-5" style={{ zoom }}>
          {doc.pages.map((page, i) => {
            // Where this sheet's first line falls in the schedule as a whole.
            const startNo = doc.pages.slice(0, i).reduce((n, p) => n + p.itemIds.length, 0) + 1;
            return (
            <Sheet key={i} pageNo={i + 1} total={doc.pages.length} email={email} doc={doc}>
              {doc.kind === 'mail' && <MailBody email={email} />}
              {doc.kind === 'schedule' && (
                <ScheduleBody
                  items={page.itemIds.map((id) => items.find((it) => it.id === id)!).filter(Boolean)}
                  startNo={startNo}
                  hoverId={hoverId}
                  onHoverItem={onHoverItem}
                  onOpenItem={onOpenItem}
                />
              )}
              {doc.kind === 'datasheet' &&
                page.itemIds
                  .map((id) => items.find((it) => it.id === id)!)
                  .filter(Boolean)
                  .map((item) => (
                    <DatasheetBlock
                      key={item.id}
                      item={item}
                      hovered={item.id === hoverId}
                      onHover={() => onHoverItem(item.id)}
                      onOpen={() => onOpenItem(item.id)}
                    />
                  ))}
            </Sheet>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The printed sheet
// ---------------------------------------------------------------------------

function Sheet({
  pageNo,
  total,
  email,
  doc,
  children,
}: {
  pageNo: number;
  total: number;
  email: InboxEmail;
  doc: SourceDocument;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col bg-white shadow-card"
      style={{ width: PAGE_W, minHeight: 1123 }}
    >
      <div className="flex items-start justify-between gap-4 border-b-2 border-surface-800 px-14 pb-3 pt-12">
        <div className="min-w-0">
          <p className="text-[15px] font-bold uppercase tracking-wide text-surface-900">
            {email.customerName ?? email.senderName}
          </p>
          <p className="mt-0.5 text-[10px] text-surface-500">
            Purchase &amp; Procurement · {email.senderEmail}
          </p>
        </div>
        <div className="flex-none text-right text-[10px] text-surface-500">
          <p className="font-semibold text-surface-700">Ref: {enquiryRef(email)}</p>
          <p>{docDate(email)}</p>
        </div>
      </div>

      <div className="flex-1 px-14 py-7">
        {pageNo === 1 && (
          <h1 className="mb-5 text-center text-[13px] font-bold uppercase tracking-[0.12em] text-surface-800">
            {doc.title}
          </h1>
        )}
        {children}
      </div>

      <div className="flex items-center justify-between border-t border-surface-200 px-14 pb-10 pt-2 text-[9px] text-surface-400">
        <span className="truncate">
          {doc.fileName} · issued to {COMPANY.legalName}
        </span>
        <span className="flex-none">
          Page {pageNo} of {total}
        </span>
      </div>
    </div>
  );
}

function MailBody({ email }: { email: InboxEmail }) {
  return (
    <div className="text-[11px] leading-relaxed text-surface-800">
      <dl className="mb-5 grid grid-cols-[76px_1fr] gap-x-3 gap-y-1 border-b border-dashed border-surface-300 pb-4 text-[10px]">
        <dt className="font-semibold uppercase tracking-wide text-surface-400">From</dt>
        <dd>
          {email.senderName} &lt;{email.senderEmail}&gt;
        </dd>
        <dt className="font-semibold uppercase tracking-wide text-surface-400">To</dt>
        <dd>{email.recipient}</dd>
        {email.cc.length > 0 && (
          <>
            <dt className="font-semibold uppercase tracking-wide text-surface-400">Cc</dt>
            <dd>{email.cc.join(', ')}</dd>
          </>
        )}
        <dt className="font-semibold uppercase tracking-wide text-surface-400">Date</dt>
        <dd>{formatDateTime(email.receivedAt)}</dd>
        <dt className="font-semibold uppercase tracking-wide text-surface-400">Subject</dt>
        <dd className="font-semibold text-surface-900">{email.subject}</dd>
      </dl>

      <div className="whitespace-pre-wrap">{email.body}</div>
    </div>
  );
}

/** The status tint a printed line carries — the same language as the matrix. */
function lineTint(item: RequirementItem, hovered: boolean): string {
  const base =
    item.status === 'error'
      ? 'bg-rose-50/80'
      : item.status === 'needs_review'
      ? 'bg-amber-50/70'
      : 'bg-emerald-50/60';
  return classNames(base, hovered && 'ring-2 ring-inset ring-brand-300');
}

function ScheduleBody({
  items,
  startNo,
  hoverId,
  onHoverItem,
  onOpenItem,
}: {
  items: RequirementItem[];
  startNo: number;
  hoverId: string | null;
  onHoverItem: (id: string | null) => void;
  onOpenItem: (id: string) => void;
}) {
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="bg-surface-100 text-surface-700">
          {['Sl.', 'Description of requirement', 'Tag no.', 'Qty', 'Unit', 'Service / remarks'].map((h) => (
            <th key={h} className="border border-surface-300 px-2 py-1.5 text-left font-bold uppercase tracking-wide">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr
            key={item.id}
            data-item-id={item.id}
            onClick={() => onOpenItem(item.id)}
            onMouseEnter={() => onHoverItem(item.id)}
            title={`${item.name} — open datasheet`}
            className={classNames('cursor-pointer align-top', lineTint(item, item.id === hoverId))}
          >
            <td className="border border-surface-300 px-2 py-1.5 tabular-nums">{startNo + i}</td>
            <td className="border border-surface-300 px-2 py-1.5">
              <span className="font-semibold text-surface-900">{item.name}</span>
              {item.sourceFields.instrumentType && (
                <span className="block text-surface-500">{item.sourceFields.instrumentType}</span>
              )}
            </td>
            <td className="border border-surface-300 px-2 py-1.5">{item.sourceFields.tag || item.tag}</td>
            <td className="border border-surface-300 px-2 py-1.5 tabular-nums">
              {item.quantityRaw.trim() ? item.quantityRaw.replace(/\s*nos\.?$/i, '') : <Blank />}
            </td>
            <td className="border border-surface-300 px-2 py-1.5">{item.unit || 'Nos'}</td>
            <td className="border border-surface-300 px-2 py-1.5 text-surface-600">
              {item.sourceFields.service || item.service}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** An unfilled field, printed the way a blank on a form looks. */
function Blank() {
  return <span className="inline-block w-24 border-b border-dotted border-surface-400 align-middle" />;
}

function DatasheetBlock({
  item,
  hovered,
  onHover,
  onOpen,
}: {
  item: RequirementItem;
  hovered: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const required = REQUIRED_FIELDS[item.domain];

  // What the enquiry actually printed here: every particular it stated, plus the
  // ones it was supposed to state and left blank. A field it neither stated nor
  // owed — an MCCB's viscosity — was never on the customer's form either.
  const bands = MATRIX_BANDS.map((band) => ({
    ...band,
    fields: band.fields.filter(
      (spec) =>
        spec.key !== 'tag' &&
        spec.key !== 'quantity' &&
        spec.key !== 'meterIdentity' &&
        ((item.sourceFields[spec.key] ?? '').trim() !== '' || required.includes(spec.key))
    ),
  })).filter((band) => band.fields.length > 0);

  return (
    <section
      data-item-id={item.id}
      onClick={onOpen}
      onMouseEnter={onHover}
      title={`${item.name} — open datasheet`}
      className={classNames(
        'mb-5 cursor-pointer border border-surface-300 text-[10px] last:mb-0',
        hovered && 'ring-2 ring-inset ring-brand-300'
      )}
    >
      <div className={classNames('border-b border-surface-300 px-3 py-1.5', lineTint(item, false))}>
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate font-bold uppercase tracking-wide text-surface-900">
            {item.sourceFields.tag || item.tag}
          </span>
          <span className="flex-none tabular-nums text-surface-600">
            Qty {item.quantityRaw.trim() || '—'}
          </span>
        </p>
        <p className="truncate text-surface-600">{item.name}</p>
      </div>

      <div className="px-3 py-2">
        {bands.map((band) => (
          <div key={band.id} className="mb-2 last:mb-0">
            <p className="mb-1 border-b border-surface-200 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-surface-500">
              {band.title}
            </p>
            <dl className="grid grid-cols-2 gap-x-6">
              {band.fields.map((spec) => {
                const value = (item.sourceFields[spec.key] ?? '').trim();
                return (
                  <div key={spec.key} className="flex items-baseline justify-between gap-2 border-b border-dotted border-surface-200 py-0.5">
                    <dt className="min-w-0 flex-1 truncate text-surface-500">{fieldLabel(spec, item.domain)}</dt>
                    <dd className={classNames('flex-none text-right', value ? 'font-semibold text-surface-900' : '')}>
                      {value ? (
                        <>
                          {spec.kind === 'toggle' ? (value === 'yes' ? 'Yes' : 'No') : value}
                          {spec.unit && <span className="ml-0.5 font-normal text-surface-500">{spec.unit}</span>}
                        </>
                      ) : (
                        <Blank />
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
