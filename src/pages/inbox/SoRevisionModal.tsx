import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Boxes,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  Mail,
  Paperclip,
  Receipt,
  Save,
  User2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  CommercialTerms,
  InboxEmail,
  LineItem,
  Party,
  PaymentTerms,
  RequestedChange,
  SalesOrder,
  SalesOrderAttachment,
  SORevisionSnapshot,
  TechnicalSpecs,
} from '@/types';
import {
  Button,
  Modal,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { ITEMS } from '@/data/masters';
import { emailSignature } from '@/lib/brand';
import { resolveSalesOrder, type ResolvedSalesOrder } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { OWNERS, USERS } from '@/data/users';
import {
  amountInWords,
  classNames,
  computeTotals,
  formatDate,
  formatINR,
  lineTotal,
} from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';
import { applyProposed } from '@/lib/revisionQueue';
import { specsForLine, TECH_SPEC_FIELDS } from '@/lib/technicalSpecs';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const DRAFT_TS = '2026-08-13T12:38:00';
const ATTACH_TS = '2026-08-13T12:42:00';

const clone = (it: LineItem): LineItem => ({ ...it });

// Parse a free-text payment phrase (e.g. "50% Advance, 50% Before Dispatch")
// into the four structured payment buckets. Returns null if nothing matched so
// the caller can leave the existing terms untouched.
function parsePaymentPhrase(text: string): PaymentTerms | null {
  const buckets: PaymentTerms = { advance: 0, beforeDispatch: 0, creditDays: 0, afterInstall: 0 };
  let matched = false;
  text.split(/,|;|\band\b/i).forEach((part) => {
    const pct = part.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pct) return;
    const val = Number(pct[1]);
    if (/install/i.test(part)) buckets.afterInstall += val;
    else if (/credit/i.test(part)) buckets.creditDays += val;
    else if (/dispatch|delivery|before/i.test(part)) buckets.beforeDispatch += val;
    else if (/advance/i.test(part)) buckets.advance += val;
    else return;
    matched = true;
  });
  return matched ? buckets : null;
}

// Clearer, spec-aligned labels for the four payment buckets.
const SO_PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

// The editable revised-order form. Snapshot fields (items, payment, delivery,
// addresses) are versioned; the extended client/order fields ride along on the
// live SO record without minting a new SO number.
interface RevForm {
  billingAddress: string;
  shippingAddress: string;
  sameAsBilling: boolean;
  phone: string;
  email: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionEmail: string;
  poNumber: string;
  poDate: string;
  officeId: string;
  owner: string;
  officeAdmin: string;
  packingPct: number;
  deliveryTerms: string;
  warrantyYears: number;
  creditDays: number;
  payment: PaymentTerms;
  expectedDelivery: string;
}

// Prefill the revised form from the SO's current revision draft when present,
// otherwise from the immutable Original snapshot — never overwriting either.
function initRevForm(
  so: SalesOrder,
  base: SORevisionSnapshot,
  party: Party | undefined,
  ct: CommercialTerms
): RevForm {
  const taxable = computeTotals(base.items, 0).taxable;
  const derivedPacking = taxable > 0 ? Math.round((so.packingCharges / taxable) * 100) : ct.packingPct;
  return {
    billingAddress: base.billingAddress,
    shippingAddress: base.shippingAddress,
    sameAsBilling: false,
    phone: so.customerPhone ?? party?.phone ?? '',
    email: so.customerEmail ?? party?.email ?? '',
    gstin: party?.gstin ?? '',
    kindAttentionName: so.kindAttentionName ?? party?.contactPerson ?? '',
    kindAttentionEmail: so.kindAttentionEmail ?? party?.email ?? '',
    poNumber: so.poNumber,
    poDate: so.poDate,
    officeId: so.officeId,
    owner: so.revisionOwner ?? so.owner,
    officeAdmin: so.officeAdmin ?? '',
    packingPct: so.commercials?.packingPct ?? derivedPacking,
    deliveryTerms: base.deliveryTerms || defaultDeliveryOption(ct)?.name || '',
    warrantyYears: parseInt(so.warranty, 10) || ct.warrantyYears,
    creditDays: so.commercials?.creditDays ?? 0,
    payment: so.commercials?.payment ? { ...so.commercials.payment } : { ...ct.payment },
    expectedDelivery: base.deliveryDate ?? '',
  };
}

/**
 * Revise Sales Order — the revised SO, edited at full width.
 *
 * A minor revision means re-cutting a confirmed order: five sections of items,
 * addresses and commercial terms, measured field by field against the Original.
 * That does not fit a 320px right column, so it lives here — a large scrollable
 * sheet with the customer's requested changes pinned above the form they are
 * meant to be applied to, and clear Original / Revised tabs so the two versions
 * can be read against each other.
 *
 * Nothing is sent from here. Preview and "Add Revised SO to Email" stay locked
 * until every requested change is actually reflected in the form and the order
 * is valid — an unapplied ask or an unselected delivery term cannot reach the
 * customer. Adding to the email attaches the generated revised SO PDF and hands
 * over to the compose popup, which is the one surface that sends and the one
 * that cuts the next revision.
 */
export function SoRevisionModal({
  email,
  salesOrder,
  onAddedToEmail,
  onClose,
}: {
  email: InboxEmail;
  salesOrder: SalesOrder;
  onAddedToEmail: () => void;
  onClose: () => void;
}) {
  const {
    parties,
    items: catalog,
    commercialTerms,
    role,
    updateSalesOrder,
    updateEmail,
    addToast,
    currentUser,
    can,
  } = useApp();

  const so = salesOrder;
  const canRevise = can('sales_orders', 'edit');
  const party = parties.find((p) => p.id === so.partyId);
  const changes = email.requestedChanges ?? [];

  // Immutable Original snapshot (versions[0]) is the comparison baseline. The
  // revised working point starts from the saved draft when one exists.
  const original: SORevisionSnapshot = useMemo(
    () =>
      so.versions[0]?.snapshot ?? {
        items: so.items.map(clone),
        paymentTerms: so.paymentTerms,
        deliveryTerms: so.deliveryTerms,
        deliveryDate: so.deliveryDate,
        billingAddress: so.billingAddress,
        shippingAddress: so.shippingAddress,
      },
    [so]
  );
  const base = so.revisionDraft ?? original;
  const nextRevNum = so.revisionNumber + 1;

  const [tab, setTab] = useState<'original' | 'revised'>('revised');
  const [form, setForm] = useState<RevForm>(() => initRevForm(so, base, party, commercialTerms));
  // The values the form was prefilled with — the baseline for "did the owner
  // change this field this session". Commercial fields (esp. payment, which the
  // Original stores only as free text) are compared against this rather than the
  // Original's differently-formatted strings, so nothing is falsely highlighted
  // on load. Line items compare against the structured Original snapshot below.
  const initialForm = useMemo(() => initRevForm(so, base, party, commercialTerms), [so.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lines, setLines] = useState<LineItem[]>(() => base.items.map(clone));
  const [specs, setSpecs] = useState<Record<string, TechnicalSpecs>>(() => {
    const map: Record<string, TechnicalSpecs> = {};
    base.items.forEach((l) => (map[l.id] = specsForLine(l, catalog)));
    return map;
  });
  const [preview, setPreview] = useState<null | 'original' | 'revised'>(null);

  // The page behind must not scroll while this holds the screen. Escape closes
  // it — unless the document preview is up, which owns Escape for itself.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && preview === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, onClose]);

  const set = <K extends keyof RevForm>(k: K, v: RevForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const deliveryChoices = useMemo(() => activeDeliveryOptions(commercialTerms), [commercialTerms]);
  const officeAdmins = useMemo(() => {
    const inOffice = USERS.filter((u) => u.role === 'office_admin' && u.officeId === form.officeId && u.active);
    const list = inOffice.length ? inOffice : USERS.filter((u) => u.role === 'office_admin' && u.active);
    return list.map((u) => u.fullName);
  }, [form.officeId]);

  const effectiveShipping = form.sameAsBilling ? form.billingAddress : form.shippingAddress;
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * form.packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  const paymentSum = paymentTotal(form.payment);
  const contact = (party?.contactPerson ?? so.customerName.split(' ')[0] ?? 'Sir/Madam').trim();

  // ---- Change detection (revised vs immutable Original) --------------------
  const origLine = (id: string) => original.items.find((l) => l.id === id);
  const lineChange = (l: LineItem) => {
    const o = origLine(l.id);
    return {
      isNew: !o,
      qty: !!o && o.quantity !== l.quantity,
      price: !!o && o.unitPrice !== l.unitPrice,
      disc: !!o && o.discountPct !== l.discountPct,
      old: o,
    };
  };
  const paymentTextOf = (f: RevForm) =>
    formatPaymentTerms(f.payment) + (f.creditDays > 0 ? `, ${f.creditDays} Credit Days` : '');
  const initialShipping = initialForm.sameAsBilling ? initialForm.billingAddress : initialForm.shippingAddress;
  const changedFields = useMemo(() => ({
    delivery: initialForm.deliveryTerms !== form.deliveryTerms,
    deliveryDate: initialForm.expectedDelivery !== form.expectedDelivery,
    payment: paymentTextOf(initialForm) !== paymentTextOf(form),
    warranty: initialForm.warrantyYears !== form.warrantyYears,
    billing: initialForm.billingAddress !== form.billingAddress,
    shipping: initialShipping !== effectiveShipping,
  }), [initialForm, form, effectiveShipping, initialShipping]);
  const changeCount = useMemo(() => {
    let n = 0;
    lines.forEach((l) => {
      const c = lineChange(l);
      if (c.isNew || c.qty || c.price || c.disc) n += 1;
    });
    if (original.items.some((o) => !lines.find((l) => l.id === o.id))) n += 1; // removed line(s)
    n += Object.values(changedFields).filter(Boolean).length;
    return n;
  }, [lines, changedFields, original]);

  // ---- "Has this ask actually been applied?" --------------------------------
  // Read off the live form rather than a one-shot "I pressed Apply" flag, so
  // hand-editing a value back to what the customer asked for counts, and
  // undoing an applied change re-locks the send.
  const changeApplied = (c: RequestedChange): boolean => {
    if (c.field && c.itemId && typeof c.itemProposed === 'number') {
      const line = lines.find((l) => l.id === c.itemId);
      // The line the ask was about has been removed — it cannot stay pending
      // against something that is no longer in the order.
      if (!line) return true;
      return line[c.field] === c.itemProposed;
    }
    const nv = c.newValue.trim();
    if (c.type === 'delivery') {
      const cur = form.deliveryTerms.trim().toLowerCase();
      const want = nv.toLowerCase();
      return !!cur && (cur === want || cur.includes(want) || want.includes(cur));
    }
    if (c.type === 'payment') {
      const parsed = parsePaymentPhrase(nv);
      return !parsed || PAYMENT_FIELDS.every((f) => form.payment[f.key] === parsed[f.key]);
    }
    if (c.type === 'warranty') {
      const yrs = parseInt(nv, 10);
      return Number.isNaN(yrs) || form.warrantyYears === yrs;
    }
    // Adding, removing or substituting a catalogue item is a judgement call the
    // owner makes by hand — there is no single field to compare, so these never
    // hold the send back.
    return true;
  };
  const pendingChanges = changes.filter((c) => !changeApplied(c));

  const revisedPaymentText =
    formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');

  const buildSnapshot = (): SORevisionSnapshot => ({
    items: lines.map(clone),
    paymentTerms: revisedPaymentText,
    deliveryTerms: form.deliveryTerms,
    deliveryDate: form.expectedDelivery,
    billingAddress: form.billingAddress,
    shippingAddress: effectiveShipping,
  });

  // Non-versioned metadata that rides on the live SO (no new SO number minted).
  const buildMetaPatch = (): Partial<SalesOrder> => ({
    poNumber: form.poNumber,
    poDate: form.poDate,
    officeId: form.officeId,
    owner: form.owner,
    revisionOwner: form.owner,
    officeAdmin: form.officeAdmin || undefined,
    customerPhone: form.phone || undefined,
    customerEmail: form.email || undefined,
    kindAttentionName: form.kindAttentionName || undefined,
    kindAttentionEmail: form.kindAttentionEmail || undefined,
    warranty: formatWarranty(form.warrantyYears),
    packingCharges: packingAmount,
    commercials: { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
  });

  const validate = (): string | null => {
    if (!canRevise) return 'You do not have permission to revise Sales Orders.';
    if (lines.length === 0) return 'Add at least one line item.';
    if (lines.some((l) => !l.itemId)) return 'Every line must have an item selected.';
    if (lines.some((l) => l.quantity <= 0)) return 'Quantities must be greater than 0.';
    if (lines.some((l) => l.unitPrice <= 0)) return 'Unit price must be greater than 0.';
    if (paymentSum !== 100) return 'Payment terms must total 100%.';
    // A revised SO goes out with delivery terms on it — "not selected" is not a
    // state the customer may ever receive.
    if (!form.deliveryTerms.trim()) return 'Delivery terms must be selected.';
    if (!form.expectedDelivery) return 'Expected delivery date is required.';
    if (!form.billingAddress.trim()) return 'Billing address is required.';
    return null;
  };

  // What is stopping the revised SO from going out, in the order the owner
  // should fix it. Preview and Add-to-Email stay disabled while this is set.
  const invalid = validate();
  const blocker: string | null = pendingChanges.length
    ? `${pendingChanges.length} requested change${pendingChanges.length > 1 ? 's' : ''} not applied yet — apply ${pendingChanges.length > 1 ? 'them' : 'it'} to continue.`
    : invalid;

  // Persist the working revised snapshot + metadata. Does NOT increment the
  // revision number (that happens on send) and never overwrites the Original.
  const saveDraft = (silent = false): boolean => {
    const err = validate();
    if (err) {
      addToast({ type: 'error', title: 'Cannot save revision', message: err });
      return false;
    }
    const notes = `Revised Sales Order draft — ${changeCount} change(s) prepared for Rev ${nextRevNum}.`;
    updateSalesOrder(so.id, {
      ...buildMetaPatch(),
      revisionState: so.revisionState === 'revision_required' ? 'draft_in_progress' : so.revisionState,
      revisionDraft: buildSnapshot(),
      revisionNotes: notes,
      revisionPreviewed: false,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-revdraft-${Date.now()}`, date: DRAFT_TS, actor: currentUser.fullName, action: 'Revision draft saved', detail: notes },
      ],
    });
    if (!silent) addToast({ type: 'success', title: 'Revision draft saved', message: `Rev ${nextRevNum} draft saved. Preview it and add it to the email.` });
    return true;
  };

  // Apply the customer's requested changes to the working revised order. Every
  // requested change maps to a structured field: line qty/price directly, and
  // the commercial asks (delivery terms, payment terms, warranty) onto their
  // respective form fields — so nothing the customer asked for is silently
  // dropped.
  const applyRequested = () => {
    if (changes.length === 0) return;
    setTab('revised');
    setLines((prev) => applyProposed(prev, changes));

    const delivery = changes.find((c) => c.type === 'delivery');
    const payment = changes.find((c) => c.type === 'payment');
    const warranty = changes.find((c) => c.type === 'warranty');
    const applied: string[] = [];

    if (delivery) {
      const nv = delivery.newValue.trim();
      const match =
        deliveryChoices.find((d) => d.name.toLowerCase() === nv.toLowerCase()) ??
        deliveryChoices.find(
          (d) => d.name.toLowerCase().includes(nv.toLowerCase()) || nv.toLowerCase().includes(d.name.toLowerCase())
        );
      set('deliveryTerms', match ? match.name : nv);
      applied.push('delivery terms');
    }
    if (payment) {
      const parsed = parsePaymentPhrase(payment.newValue);
      if (parsed) {
        set('payment', parsed);
        applied.push('payment terms');
      }
    }
    if (warranty) {
      const yrs = parseInt(warranty.newValue, 10);
      if (!Number.isNaN(yrs)) {
        set('warrantyYears', yrs);
        applied.push('warranty');
      }
    }
    const lineCount = changes.filter((c) => c.field).length;
    if (lineCount) applied.unshift(`${lineCount} item change${lineCount > 1 ? 's' : ''}`);

    addToast({
      type: 'info',
      title: 'Requested changes applied',
      message: applied.length
        ? `Applied ${applied.join(', ')}. Review the highlighted fields, then save the revision.`
        : 'Review the highlighted fields, then save the revision.',
    });
  };

  // A short bullet summary of the applied changes for the email body.
  const summariseChanges = (): string => {
    const bullets: string[] = [];
    lines.forEach((l) => {
      const c = lineChange(l);
      if (c.isNew) {
        bullets.push(`  • Added: ${l.description || l.itemCode} — ${l.quantity} ${l.unit} @ ${formatINR(l.unitPrice)}`);
        return;
      }
      if (c.qty && c.old) bullets.push(`  • ${l.description}: Qty ${c.old.quantity} → ${l.quantity} ${l.unit}`);
      if (c.price && c.old) bullets.push(`  • ${l.description}: Unit price ${formatINR(c.old.unitPrice)} → ${formatINR(l.unitPrice)}`);
      if (c.disc && c.old) bullets.push(`  • ${l.description}: Discount ${c.old.discountPct}% → ${l.discountPct}%`);
    });
    if (changedFields.delivery) bullets.push(`  • Delivery terms → ${form.deliveryTerms}`);
    if (changedFields.deliveryDate) bullets.push(`  • Expected delivery → ${formatDate(form.expectedDelivery, { short: true })}`);
    if (changedFields.payment) bullets.push(`  • Payment terms → ${revisedPaymentText}`);
    if (changedFields.warranty) bullets.push(`  • Warranty → ${formatWarranty(form.warrantyYears)}`);
    if (changedFields.billing) bullets.push('  • Billing address updated');
    if (changedFields.shipping) bullets.push('  • Shipping address updated');
    return bullets.length ? bullets.join('\n') : '  • Commercial terms reviewed and reconfirmed';
  };

  // Generate the revised Sales Order Acknowledgement PDF, attach it to the
  // reply and hand over to the compose popup. Only this system-generated
  // document can be attached — there is no generic file upload.
  const addToEmail = () => {
    if (blocker) {
      addToast({ type: 'error', title: 'Cannot add to email', message: blocker });
      return;
    }
    if (!saveDraft(true)) return;
    const value = totals.grandTotal;
    const changeLines = summariseChanges();
    const attach: SalesOrderAttachment = {
      fileName: `${so.number.replace(/\//g, '-')}-Rev${nextRevNum}.pdf`,
      soNumber: so.number,
      fileType: 'PDF',
      value,
      addedBy: 'system',
      addedAt: ATTACH_TS,
      sizeLabel: `${150 + lines.length * 8} KB`,
      revisionNumber: nextRevNum,
      revisionLabel: `Rev ${nextRevNum} · Revised`,
      kind: 'revised',
    };
    updateEmail(email.id, {
      composeIntent: 'so-revise',
      attachedQuote: undefined,
      attachedSalesOrder: attach,
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Revised Sales Order ${so.number} - Revision ${nextRevNum}`,
        body:
          `Dear ${contact},\n\n` +
          `Thank you for your revision request against Sales Order ${so.number} (PO ${so.poNumber}).\n\n` +
          `Please find attached the revised Sales Order Acknowledgement (Revision ${nextRevNum}) reflecting the following updates:\n` +
          `${changeLines}\n\n` +
          `Revised order value: ${formatINR(value)}.\n\n` +
          `Kindly review and confirm so we may proceed accordingly.\n\n` +
          emailSignature(form.owner, officeName(form.officeId)),
        relatedDoc: so.number,
        amount: value,
        aiGenerated: true,
      },
    });
    addToast({
      type: 'success',
      title: 'Revised SO added to email',
      message: `${so.number} (Rev ${nextRevNum}) attached. Set the next review date and send from the compose window.`,
    });
    onAddedToEmail();
  };

  const attachedRev = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-revise';

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center p-2 sm:p-4">
      {/* Backdrop closes only via the header X / Escape — a stray click must not
          discard a half-prepared revision. */}
      <div className="absolute inset-0 bg-surface-900/45 backdrop-blur-[1px] animate-fade-in" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Revise Sales Order"
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        {/* Sticky header + tabs */}
        <div className="flex-none border-b border-surface-200 bg-white">
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-3.5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-surface-800">
                <FileSpreadsheet className="h-5 w-5 flex-none text-brand-600" />
                Revise Sales Order
              </h2>
              <p className="mt-0.5 truncate text-[11.5px] text-surface-500">
                {so.number} · {so.customerName} · Rev {so.revisionNumber}
                {so.revisionNumber === 0 ? ' (Original)' : ''} → preparing Rev {nextRevNum}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close revised Sales Order editor"
              className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 px-5">
            <TabButton active={tab === 'original'} onClick={() => setTab('original')} icon={<FileText className="h-3.5 w-3.5" />}>
              Original SO
            </TabButton>
            <TabButton active={tab === 'revised'} onClick={() => setTab('revised')} icon={<FilePenLine className="h-3.5 w-3.5" />}>
              Revised SO{changeCount > 0 ? ` · ${changeCount} change${changeCount > 1 ? 's' : ''}` : ''}
            </TabButton>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {/* Requested changes — pinned so the customer's asks stay in view
              while the order below them is edited to match. */}
          {changes.length > 0 && (
            <section className="sticky -top-3 z-10 -mx-5 mb-3 border-b border-amber-100 bg-amber-50/95 px-5 py-2.5 backdrop-blur-sm">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Requested Changes — {email.customerName}
                  {pendingChanges.length === 0 ? (
                    <span className="ml-1.5 font-semibold normal-case tracking-normal text-emerald-700">all applied</span>
                  ) : (
                    <span className="ml-1.5 font-semibold normal-case tracking-normal text-amber-700">
                      {pendingChanges.length} pending
                    </span>
                  )}
                </h3>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Wand2 className="h-3.5 w-3.5" />}
                  onClick={applyRequested}
                  disabled={!canRevise || pendingChanges.length === 0}
                >
                  Apply Requested Changes
                </Button>
              </div>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {changes.map((c) => (
                  <ChangeChip key={c.id} change={c} applied={changeApplied(c)} />
                ))}
              </ul>
            </section>
          )}

          {tab === 'original' ? (
            <OriginalTab so={so} original={original} onPreview={() => setPreview('original')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {/* 1. Client Details */}
              <FormSection icon={<User2 className="h-3.5 w-3.5" />} n={1} label="Client Details">
                <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                  <span className="text-surface-400">Customer / Party:</span>{' '}
                  <span className="font-semibold text-surface-800">{so.customerName}</span>
                  <span className="text-surface-400"> · {so.customerCode}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="py-1.5 text-[13px]" placeholder="+91 …" />
                  <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="py-1.5 text-[13px]" placeholder="orders@customer.com" />
                  <TextField label="GSTIN" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className="py-1.5 text-[13px]" placeholder="27AAACR…" />
                  <SelectField label="Salesperson" value={form.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
                </div>
                <TextAreaField label="Billing Address" required rows={2} value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} className={classNames('text-[13px]', changedFields.billing && 'ring-1 ring-amber-300')} />
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="label mb-0">Consignee / Shipping Address</label>
                    <label className="flex items-center gap-1.5 text-[11px] text-surface-500">
                      <Toggle checked={form.sameAsBilling} onChange={(v) => set('sameAsBilling', v)} />
                      Same as billing
                    </label>
                  </div>
                  <TextAreaField label="" rows={2} value={effectiveShipping} disabled={form.sameAsBilling} onChange={(e) => set('shippingAddress', e.target.value)} className={classNames('text-[13px]', changedFields.shipping && 'ring-1 ring-amber-300')} placeholder={form.sameAsBilling ? 'Same as billing address' : 'Shipping address'} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Kind Attention — Name" value={form.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} className="py-1.5 text-[13px]" placeholder="Contact person" />
                  <TextField label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} className="py-1.5 text-[13px]" placeholder="contact@customer.com" />
                </div>
              </FormSection>

              {/* 2. Order Details */}
              <FormSection icon={<FileText className="h-3.5 w-3.5" />} n={2} label="Order Details">
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Customer PO Number" value={form.poNumber} onChange={(e) => set('poNumber', e.target.value)} className="py-1.5 text-[13px]" />
                  <TextField label="PO Date" type="date" value={form.poDate} onChange={(e) => set('poDate', e.target.value)} className="py-1.5 text-[13px]" />
                </div>
                <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                  <span className="text-surface-400">Linked Quotation:</span>{' '}
                  <span className="font-semibold text-surface-800">{so.quotationNumber ?? '—'}</span>
                </div>
                <SelectField label="Sales Office" value={form.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === so.officeId)).map((o) => ({ value: o.id, label: o.name }))} className="py-1.5 text-[13px]" />
                <div className="grid grid-cols-2 gap-2">
                  <SelectField label="Owner / Sales Person" value={form.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
                  <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" className="py-1.5 text-[13px]" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                    <span className="text-surface-400">SO Acknowledgement No:</span>{' '}
                    <span className="font-semibold text-surface-800">{so.number}</span>
                  </div>
                  <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                    <span className="text-surface-400">SO Date:</span>{' '}
                    <span className="font-semibold text-surface-800">{formatDate(so.createdDate, { short: true })}</span>
                  </div>
                </div>
              </FormSection>

              {/* 3. Catalogue Items — full width; this is where a revision lives. */}
              <div className="xl:col-span-2">
                <FormSection
                  icon={<Boxes className="h-3.5 w-3.5" />}
                  n={3}
                  label="Catalogue Items"
                  action={<span className="text-[11px] text-surface-400">{lines.length} line(s)</span>}
                >
                  <RevItemEditor
                    items={lines}
                    catalog={catalog}
                    specs={specs}
                    original={original.items}
                    onChange={setLines}
                    onSpecs={setSpecs}
                  />
                </FormSection>
              </div>

              {/* 4. Commercial Terms */}
              <FormSection icon={<Receipt className="h-3.5 w-3.5" />} n={4} label="Commercial Terms">
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Packing (%)" type="number" min={0} max={100} value={form.packingPct} onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))} className="py-1.5 text-[13px]" hint={`≈ ${formatINR(packingAmount)}`} />
                  <TextField label="Warranty (Years)" type="number" min={1} value={form.warrantyYears} onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))} className={classNames('py-1.5 text-[13px]', changedFields.warranty && 'ring-1 ring-amber-300')} hint={changedFields.warranty ? `was ${formatWarranty(initialForm.warrantyYears)}` : undefined} />
                  <SelectField label="Delivery Terms" required value={form.deliveryTerms} onChange={(e) => set('deliveryTerms', e.target.value)} options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))} placeholder="Select delivery option" className={classNames('py-1.5 text-[13px]', changedFields.delivery && 'ring-1 ring-amber-300', !form.deliveryTerms.trim() && 'ring-1 ring-rose-300')} wrapClassName="col-span-2" hint={changedFields.delivery ? `was ${initialForm.deliveryTerms || '—'}` : undefined} />
                  <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} className={classNames('py-1.5 text-[13px]', changedFields.deliveryDate && 'ring-1 ring-amber-300')} wrapClassName="col-span-2" hint={changedFields.deliveryDate && initialForm.expectedDelivery ? `was ${formatDate(initialForm.expectedDelivery, { short: true })}` : undefined} />
                </div>
                <div>
                  <label className="label">Payment Terms</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PAYMENT_FIELDS.map((f) => (
                      <div key={f.key}>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className={classNames('input py-1.5 pr-7 text-[13px]', changedFields.payment && initialForm.payment[f.key] !== form.payment[f.key] && 'bg-amber-50 ring-1 ring-inset ring-amber-300')}
                            value={form.payment[f.key]}
                            onChange={(e) => set('payment', { ...form.payment, [f.key]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-surface-400">%</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-surface-500">{SO_PAYMENT_LABEL[f.key]}</p>
                        {initialForm.payment[f.key] !== form.payment[f.key] && (
                          <p className="text-[11px] text-amber-600">was {initialForm.payment[f.key]}%</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={classNames('mt-1.5 text-[11px] font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                    Total: {paymentSum}%{paymentSum !== 100 && ' — must total 100%.'}
                  </div>
                </div>
                <TextField label="Credit Days" type="number" min={0} value={form.creditDays} onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))} className="py-1.5 text-[13px]" hint="Credit period in days (if applicable)" />
              </FormSection>

              {/* 5. Amount Summary */}
              <FormSection icon={<Calculator className="h-3.5 w-3.5" />} n={5} label="Amount Summary">
                <InfoRow label="Total Quantity" value={`${lines.reduce((s, l) => s + l.quantity, 0)}`} />
                <InfoRow label="Basic Amount" value={formatINR(totals.subtotal)} />
                <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
                <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
                <InfoRow label="GST / IGST" value={formatINR(totals.tax)} />
                <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
                <div className="mt-1.5 flex items-center justify-between border-t border-surface-200 pt-2">
                  <span className="text-[13px] font-semibold text-surface-800">Grand Total</span>
                  <span className="text-[15px] font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
                </div>
                <p className="mt-1 text-[11px] italic text-surface-500">{amountInWords(totals.grandTotal)}</p>
                <div className="mt-1.5 flex items-center justify-between border-t border-surface-100 pt-2 text-[12px]">
                  <span className="text-surface-500">Original order value</span>
                  <span className="tabular-nums text-surface-500">{formatINR(computeTotals(original.items, so.packingCharges).grandTotal)}</span>
                </div>
              </FormSection>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-surface-100 bg-surface-50/60 px-5 py-2.5">
          <p className={classNames('min-w-0 flex-1 truncate text-[11px]', blocker ? 'font-medium text-rose-600' : 'text-surface-500')}>
            {blocker ??
              (attachedRev
                ? 'Revised SO already attached — update it to re-attach the latest version.'
                : 'Ready to send. Saving keeps the Original intact; nothing leaves the platform until you send the email.')}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={() => saveDraft()} disabled={!canRevise}>
              Save Draft
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => setPreview('revised')}
              disabled={!!blocker}
              title={blocker ?? 'Preview the revised Sales Order'}
            >
              Preview Revised SO
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={attachedRev ? <Paperclip className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
              onClick={addToEmail}
              disabled={!!blocker}
              title={blocker ?? 'Attach the revised Sales Order and open the compose window'}
            >
              {attachedRev ? 'Update Revised SO in Email' : 'Add Revised SO to Email'}
            </Button>
          </div>
        </div>
      </div>

      {preview !== null && (() => {
        const isOrig = preview === 'original';
        const previewLines = isOrig ? original.items : lines;
        const previewPacking = Math.round((computeTotals(previewLines, 0).taxable * form.packingPct) / 100);
        const soForDoc: SalesOrder = {
          ...so,
          items: previewLines,
          billingAddress: isOrig ? original.billingAddress : form.billingAddress,
          shippingAddress: isOrig ? original.shippingAddress : effectiveShipping,
          deliveryDate: isOrig ? original.deliveryDate : form.expectedDelivery,
          paymentTerms: isOrig ? original.paymentTerms : revisedPaymentText,
          deliveryTerms: isOrig ? original.deliveryTerms : form.deliveryTerms,
          officeId: isOrig ? so.officeId : form.officeId,
          poNumber: isOrig ? so.poNumber : form.poNumber,
          packingCharges: previewPacking,
          // Revised preview must reflect the revised commercial terms and the
          // revision it is preparing — the resolver reads commercials/warranty/
          // revisionNumber, so override them (not just the flat paymentTerms).
          warranty: isOrig ? so.warranty : formatWarranty(form.warrantyYears),
          revisionNumber: isOrig ? 0 : nextRevNum,
          commercials: isOrig
            ? so.commercials
            : { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
          kindAttention: form.kindAttentionName ? { name: form.kindAttentionName } : so.kindAttention,
        };
        const resolved = resolveSalesOrder(soForDoc, { parties, catalog: ITEMS });
        return (
          <SoRevisionPreviewModal
            open
            onClose={() => setPreview(null)}
            title={isOrig ? 'Original Sales Order Preview' : `Revised Sales Order Preview · Rev ${nextRevNum}`}
            subtitle={`${so.number} · ${so.customerName}`}
            resolved={resolved}
          />
        );
      })()}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// One requested change, with whether the revised order already reflects it.
// ---------------------------------------------------------------------------
function ChangeChip({ change, applied }: { change: RequestedChange; applied: boolean }) {
  return (
    <li className={classNames('rounded-lg border bg-white px-2.5 py-1.5', applied ? 'border-emerald-200' : 'border-amber-300')}>
      <p className="flex items-center gap-1 truncate text-[11px] font-medium text-surface-500" title={change.label}>
        {applied ? (
          <CheckCircle2 className="h-3 w-3 flex-none text-emerald-600" />
        ) : (
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />
        )}
        {change.label}
        <span className={classNames('ml-auto flex-none text-[10.5px] font-semibold', applied ? 'text-emerald-600' : 'text-amber-600')}>
          {applied ? 'applied' : 'pending'}
        </span>
      </p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
        <span className="truncate text-surface-400 line-through">{change.oldValue}</span>
        <ArrowRight className="h-3 w-3 flex-none text-surface-300" />
        <span className="truncate font-semibold text-emerald-700">{change.newValue}</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Original Sales Order — read-only tab.
// ---------------------------------------------------------------------------
function OriginalTab({
  so,
  original,
  onPreview,
}: {
  so: SalesOrder;
  original: SORevisionSnapshot;
  onPreview: () => void;
}) {
  const totals = computeTotals(original.items, so.packingCharges);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-200 bg-surface-50/60 px-3 py-2 text-[11.5px] text-surface-500">
        This is the confirmed Sales Order as originally acknowledged. It is read-only — make changes on the Revised SO tab.
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Delivery Terms:</span> <span className="font-medium text-surface-800">{original.deliveryTerms}</span></p>
          <p><span className="text-surface-400">Delivery Date:</span> <span className="font-medium text-surface-800">{original.deliveryDate ? formatDate(original.deliveryDate, { short: true }) : '—'}</span></p>
          <p className="sm:col-span-2 lg:col-span-3"><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-800">{original.paymentTerms}</span></p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit Price</th>
              <th className="px-2 py-2 text-right">Disc %</th>
              <th className="px-3 py-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {original.items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description || '—'}</p><p className="text-[11px] text-surface-400">{it.itemCode}{it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}</p></td>
                <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                <td className="px-2 py-2 text-right text-surface-700">{it.discountPct}%</td>
                <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-xs space-y-0.5">
        <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
        <InfoRow label="GST" value={formatINR(totals.tax)} />
        <div className="mt-1 flex items-center justify-between border-t border-surface-200 pt-2">
          <span className="text-[13px] font-semibold text-surface-800">Order Value</span>
          <span className="text-[15px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
        </div>
      </div>

      <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={onPreview}>
        Preview Original SO
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalogue-item editor with per-line expandable Technical Specifications and
// old → new change highlighting against the Original snapshot.
// ---------------------------------------------------------------------------
let revLineSeq = 0;

function RevItemEditor({
  items,
  catalog,
  specs,
  original,
  onChange,
  onSpecs,
}: {
  items: LineItem[];
  catalog: import('@/types').Item[];
  specs: Record<string, TechnicalSpecs>;
  original: LineItem[];
  onChange: (lines: LineItem[]) => void;
  onSpecs: (updater: (prev: Record<string, TechnicalSpecs>) => Record<string, TechnicalSpecs>) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const origById = (id: string) => original.find((o) => o.id === id);

  const update = (id: string, patch: Partial<LineItem>) => {
    onChange(items.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const onSelectItem = (id: string, itemId: string) => {
    const cat = catalog.find((c) => c.id === itemId);
    if (!cat) {
      update(id, { itemId: '', itemCode: '', description: '', hsnCode: '', unit: '', unitPrice: 0 });
      return;
    }
    update(id, { itemId: cat.id, itemCode: cat.code, description: cat.name, hsnCode: cat.hsnCode, unit: cat.unit, unitPrice: cat.unitPrice });
    onSpecs((prev) => ({ ...prev, [id]: specsForLine({ ...cat, itemId: cat.id, itemCode: cat.code, description: cat.name } as unknown as LineItem, catalog) }));
  };

  const addLine = () => {
    const id = `revln-${++revLineSeq}`;
    onChange([...items, { id, itemId: '', itemCode: '', description: '', hsnCode: '', quantity: 1, unit: 'Nos', unitPrice: 0, discountPct: 0, taxPct: 18 }]);
    onSpecs((prev) => ({ ...prev, [id]: {} }));
  };

  const removeLine = (id: string) => {
    onChange(items.filter((l) => l.id !== id));
    setOpenId((o) => (o === id ? null : o));
  };

  const setSpecField = (id: string, key: keyof TechnicalSpecs, value: string) => {
    onSpecs((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  };

  const changedCell = 'bg-amber-50 ring-1 ring-inset ring-amber-300 rounded';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((line) => {
          const o = origById(line.id);
          const isNew = !o;
          const qtyChanged = !!o && o.quantity !== line.quantity;
          const priceChanged = !!o && o.unitPrice !== line.unitPrice;
          const discChanged = !!o && o.discountPct !== line.discountPct;
          const open = openId === line.id;
          const sp = specs[line.id] ?? {};
          return (
            <div key={line.id} className={classNames('rounded-xl border', isNew ? 'border-emerald-300' : 'border-surface-200')}>
              <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
                <select
                  value={line.itemId}
                  onChange={(e) => onSelectItem(line.id, e.target.value)}
                  className="input min-w-[180px] flex-1 py-1.5 text-[13px]"
                >
                  <option value="">Select item…</option>
                  {catalog.filter((c) => c.active || c.id === line.itemId).map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
                {isNew && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-200">New</span>}
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  className="rounded p-1.5 text-surface-400 hover:bg-rose-50 hover:text-rose-500"
                  aria-label="Remove line"
                >
                  <Trash2Icon />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 px-2.5 pb-2 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Qty</span>
                  <input type="number" min={0} value={line.quantity} onChange={(e) => update(line.id, { quantity: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', qtyChanged && changedCell)} />
                  {qtyChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {o!.quantity}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Unit Price</span>
                  <input type="number" min={0} value={line.unitPrice} onChange={(e) => update(line.id, { unitPrice: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', priceChanged && changedCell)} />
                  {priceChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {formatINR(o!.unitPrice)}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Disc %</span>
                  <input type="number" min={0} max={100} value={line.discountPct} onChange={(e) => update(line.id, { discountPct: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', discChanged && changedCell)} />
                  {discChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {o!.discountPct}%</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">GST %</span>
                  <input type="number" min={0} max={100} value={line.taxPct} onChange={(e) => update(line.id, { taxPct: Math.max(0, Number(e.target.value)) })} className="input py-1.5 text-right text-[13px]" />
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-surface-100 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : line.id)}
                  className="flex items-center gap-1 text-[11.5px] font-medium text-brand-600 hover:text-brand-700"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Technical Specifications
                </button>
                <span className="text-[11.5px] text-surface-500">HSN {line.hsnCode || '—'} · {line.unit || '—'} · <span className="font-medium text-surface-800">{formatINR(lineTotal(line.quantity, line.unitPrice, line.discountPct))}</span></span>
              </div>

              {open && (
                <div className="grid grid-cols-1 gap-2 border-t border-surface-100 bg-surface-50/50 px-2.5 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {TECH_SPEC_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-0.5 block text-[11px] text-surface-500">{f.label}</span>
                      <input
                        type={f.key === 'expectedArrival' ? 'date' : 'text'}
                        value={(sp[f.key] as string) ?? ''}
                        onChange={(e) => setSpecField(line.id, f.key, e.target.value)}
                        className="input py-1.5 text-[12.5px]"
                        placeholder={f.label}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-200 px-3 py-6 text-center text-[12px] text-surface-400">No line items — add one below.</div>
        )}
      </div>
      <Button variant="secondary" size="sm" leftIcon={<PlusIcon />} onClick={addLine} type="button">Add Line</Button>
    </div>
  );
}

// Small local icons to avoid another lucide import churn.
function Trash2Icon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>;
}
function PlusIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>;
}

// ---------------------------------------------------------------------------
// Compact section wrapper (mirrors the SO Generation form's FormSection).
// ---------------------------------------------------------------------------
function FormSection({
  icon,
  n,
  label,
  action,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="h-fit rounded-xl border border-surface-200">
      <div className="flex items-center justify-between gap-2 border-b border-surface-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-surface-700"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 flex-none text-surface-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-surface-400" />}
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded bg-brand-50 text-brand-600">{icon}</span>
          <span className="text-surface-400">{n}.</span> {label}
        </button>
        {action}
      </div>
      {open && <div className="space-y-2.5 p-3">{children}</div>}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[12.5px] font-medium transition-colors',
        active ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-500 hover:border-surface-300 hover:text-surface-700'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sales Order document preview — original or revised.
// ---------------------------------------------------------------------------
function SoRevisionPreviewModal({
  open,
  onClose,
  title,
  subtitle,
  resolved,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  resolved: ResolvedSalesOrder;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={title}
      subtitle={subtitle}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <SalesOrderDocument resolved={resolved} showLetterhead />
    </Modal>
  );
}
