import { useMemo, useState } from 'react';
import {
  FileText,
  FileSpreadsheet,
  Eye,
  Save,
  Mail,
  Paperclip,
  User2,
  Boxes,
  Receipt,
  Calculator,
  History,
  FilePenLine,
  Wand2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Ban,
} from 'lucide-react';
import type {
  CommercialTerms,
  InboxEmail,
  LineItem,
  Party,
  PaymentTerms,
  SalesOrder,
  SalesOrderAttachment,
  SORevisionSnapshot,
  TechnicalSpecs,
} from '@/types';
import {
  Button,
  Modal,
  StatusBadge,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
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
import { REVISION_STATE } from '@/lib/labels';
import { specsForLine, TECH_SPEC_FIELDS } from '@/lib/technicalSpecs';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const TODAY_ISO = '2026-08-13';
const DRAFT_TS = '2026-08-13T12:38:00';
const ATTACH_TS = '2026-08-13T12:42:00';

const clone = (it: LineItem): LineItem => ({ ...it });

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
 * RIGHT panel for a "Sales Order Revision" conversation — the Sales Order
 * Revision workspace. It mirrors the customer's revision request against the
 * confirmed Sales Order and lets the owner prepare a revised Sales Order
 * Acknowledgement. Everything happens INSIDE the Global Inbox:
 *   • Original Sales Order tab — read-only view of the confirmed order.
 *   • Revised Sales Order tab — the same five sections as Create SO Manually,
 *     prefilled from the current order, with per-item Technical Specifications
 *     and old → new change highlighting.
 * The panel only PREPARES the email: Save Revision Draft persists the working
 * snapshot, Add Revised SO to Email attaches the generated revised SO PDF and
 * prefills the centre composer. Nothing is sent from here — the final send is
 * the middle composer's, which promotes the draft to a new immutable version.
 */
export function SoRevisionPanel({
  email,
  salesOrder,
  onPrepared,
}: {
  email: InboxEmail;
  salesOrder: SalesOrder;
  onPrepared?: () => void;
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
    if (!form.expectedDelivery) return 'Expected delivery date is required.';
    if (!form.billingAddress.trim()) return 'Billing address is required.';
    return null;
  };

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

  // Apply the customer's requested changes to the working revised order. Line
  // proposals map directly; commercial asks map where a structured field exists.
  const applyRequested = () => {
    const changes = email.requestedChanges ?? [];
    if (changes.length === 0) return;
    setLines((prev) => applyProposed(prev, changes));
    const delivery = changes.find((c) => c.type === 'delivery');
    const warranty = changes.find((c) => c.type === 'warranty');
    if (delivery) {
      const match = deliveryChoices.find((d) => d.name.toLowerCase() === delivery.newValue.toLowerCase());
      if (match) set('deliveryTerms', match.name);
    }
    if (warranty) {
      const yrs = parseInt(warranty.newValue, 10);
      if (!Number.isNaN(yrs)) set('warrantyYears', yrs);
    }
    addToast({ type: 'info', title: 'Requested changes applied', message: 'Review the highlighted fields, then save the revision.' });
  };

  // Generate the revised Sales Order Acknowledgement PDF, attach it to the
  // centre composer and prefill the customer email. Only this system-generated
  // document can be attached — there is no generic file upload. The final send
  // happens from the centre panel.
  const addToEmail = () => {
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
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Added to email', message: 'Revised Sales Order attached. Set the next review date and send it from the centre panel.' });
    onPrepared?.();
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
    if (changedFields.billing) bullets.push('  • Billing address updated');
    if (changedFields.shipping) bullets.push('  • Shipping address updated');
    return bullets.length ? bullets.join('\n') : '  • Commercial terms reviewed and reconfirmed';
  };

  const attachedRev = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-revise';
  const stateMeta = so.revisionState ? REVISION_STATE[so.revisionState] : null;

  return (
    <div className="space-y-3">
      {/* Revision context banner */}
      <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
        <FilePenLine className="h-4 w-4 flex-none" />
        <span>
          Handling the customer's revision request for <span className="font-semibold">{so.number}</span>. Prepare the
          revised Sales Order below, then add it to the email — the revised acknowledgement is sent from the centre panel.
        </span>
      </div>

      {/* Header meta */}
      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
          </span>
          {stateMeta && <StatusBadge tone={stateMeta.tone} label={stateMeta.label} dot />}
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Current revision:</span> <span className="font-medium text-surface-800">Rev {so.revisionNumber}{so.revisionNumber === 0 ? ' (Original)' : ''} → preparing Rev {nextRevNum}</span></p>
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.revisionOwner ?? so.owner}</span></p>
          <p><span className="text-surface-400">Linked PO:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Linked quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Requested date:</span> <span className="font-medium text-surface-800">{so.revisionRequestedDate ? formatDate(so.revisionRequestedDate, { short: true }) : '—'}</span></p>
          {so.revisionReason && <p className="sm:col-span-2"><span className="text-surface-400">Reason:</span> <span className="font-medium text-surface-800">{so.revisionReason}</span></p>}
        </div>
      </div>

      {/* Requested changes */}
      {(email.requestedChanges?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
              <History className="h-3.5 w-3.5" /> Requested changes
            </span>
            <Button variant="secondary" size="sm" leftIcon={<Wand2 className="h-3.5 w-3.5" />} onClick={applyRequested} disabled={!canRevise || tab !== 'revised'}>
              Apply to revised SO
            </Button>
          </div>
          <ul className="space-y-1">
            {email.requestedChanges!.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[11.5px] text-surface-700">
                <span className="font-medium text-surface-800">{c.label}:</span>
                <span className="text-surface-400 line-through">{c.oldValue}</span>
                <ArrowRight className="h-3 w-3 text-amber-500" />
                <span className="font-semibold text-emerald-700">{c.newValue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-surface-200">
        <TabButton active={tab === 'original'} onClick={() => setTab('original')} icon={<FileText className="h-3.5 w-3.5" />}>
          Original Sales Order
        </TabButton>
        <TabButton active={tab === 'revised'} onClick={() => setTab('revised')} icon={<FilePenLine className="h-3.5 w-3.5" />}>
          Revised Sales Order{changeCount > 0 ? ` · ${changeCount}` : ''}
        </TabButton>
      </div>

      {tab === 'original' ? (
        <OriginalTab so={so} original={original} onPreview={() => setPreview('original')} />
      ) : (
        <div className="space-y-3">
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
            <div className="grid grid-cols-1 gap-2">
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
            <div className="grid grid-cols-1 gap-2">
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

          {/* 3. Catalogue Items */}
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

          {/* 4. Commercial Terms */}
          <FormSection icon={<Receipt className="h-3.5 w-3.5" />} n={4} label="Commercial Terms">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Packing (%)" type="number" min={0} max={100} value={form.packingPct} onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))} className="py-1.5 text-[13px]" hint={`≈ ${formatINR(packingAmount)}`} />
              <TextField label="Warranty (Years)" type="number" min={1} value={form.warrantyYears} onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))} className="py-1.5 text-[13px]" />
              <SelectField label="Delivery Terms" value={form.deliveryTerms} onChange={(e) => set('deliveryTerms', e.target.value)} options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))} placeholder="Select delivery option" className={classNames('py-1.5 text-[13px]', changedFields.delivery && 'ring-1 ring-amber-300')} wrapClassName="col-span-2" />
              <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} className={classNames('py-1.5 text-[13px]', changedFields.deliveryDate && 'ring-1 ring-amber-300')} wrapClassName="col-span-2" />
            </div>
            <div>
              <label className="label">Payment Terms</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="input py-1.5 pr-7 text-[13px]"
                        value={form.payment[f.key]}
                        onChange={(e) => set('payment', { ...form.payment, [f.key]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-surface-400">%</span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-surface-500">{SO_PAYMENT_LABEL[f.key]}</p>
                  </div>
                ))}
              </div>
              <div className={classNames('mt-1.5 text-[11px] font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                Total: {paymentSum}%{paymentSum !== 100 && ' — must total 100%.'}
                {changedFields.payment && paymentSum === 100 && <span className="ml-1 text-amber-600">· changed</span>}
              </div>
            </div>
            <TextField label="Credit Days" type="number" min={0} value={form.creditDays} onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))} className="py-1.5 text-[13px]" hint="Credit period in days (if applicable)" />
          </FormSection>

          {/* 5. Amount Summary */}
          <FormSection icon={<Calculator className="h-3.5 w-3.5" />} n={5} label="Amount Summary">
            <InfoRow label={`Total Quantity`} value={`${lines.reduce((s, l) => s + l.quantity, 0)}`} />
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
          </FormSection>

          {attachedRev && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
              <Paperclip className="h-4 w-4 flex-none" /> Revised Sales Order added to the email — set the next review date and send it from the centre panel.
            </div>
          )}

          {/* Actions — NO direct send here; the send is the composer's */}
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={() => saveDraft()} disabled={!canRevise}>Save Revision Draft</Button>
              <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview('revised')}>Preview Revised SO</Button>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              leftIcon={canRevise ? <Mail className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              onClick={addToEmail}
              disabled={!canRevise}
              title="Attach the revised Sales Order to the email in the centre panel"
            >
              {attachedRev ? 'Update Revised SO in Email' : 'Add Revised SO to Email'}
            </Button>
            {!canRevise && <p className="text-center text-[11px] font-medium text-rose-600">Sales Order edit permission required.</p>}
          </div>
        </div>
      )}

      <SoRevisionPreviewModal
        open={preview !== null}
        onClose={() => setPreview(null)}
        so={so}
        title={preview === 'original' ? 'Original Sales Order Preview' : `Revised Sales Order Preview · Rev ${nextRevNum}`}
        lines={preview === 'original' ? original.items : lines}
        specs={specs}
        showSpecs={preview === 'revised'}
        billing={preview === 'original' ? original.billingAddress : form.billingAddress}
        shipping={preview === 'original' ? original.shippingAddress : effectiveShipping}
        deliveryDate={preview === 'original' ? original.deliveryDate : form.expectedDelivery}
        paymentText={preview === 'original' ? original.paymentTerms : revisedPaymentText}
        deliveryTerms={preview === 'original' ? original.deliveryTerms : form.deliveryTerms}
        kindAttention={form.kindAttentionName}
        officeId={preview === 'original' ? so.officeId : form.officeId}
        poNumber={preview === 'original' ? so.poNumber : form.poNumber}
        packingPct={form.packingPct}
      />
    </div>
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
        This is the confirmed Sales Order as originally acknowledged. It is read-only — make changes on the Revised Sales Order tab.
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Delivery Terms:</span> <span className="font-medium text-surface-800">{original.deliveryTerms}</span></p>
          <p><span className="text-surface-400">Delivery Date:</span> <span className="font-medium text-surface-800">{original.deliveryDate ? formatDate(original.deliveryDate, { short: true }) : '—'}</span></p>
          <p className="sm:col-span-2"><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-800">{original.paymentTerms}</span></p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
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
                <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description || '—'}</p><p className="text-[10.5px] text-surface-400">{it.itemCode}{it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}</p></td>
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

      <Button variant="secondary" size="sm" className="w-full" leftIcon={<Eye className="h-4 w-4" />} onClick={onPreview}>
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
                {isNew && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-200">New</span>}
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
                  <span className="mb-0.5 block text-[10.5px] text-surface-500">Qty</span>
                  <input type="number" min={0} value={line.quantity} onChange={(e) => update(line.id, { quantity: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', qtyChanged && changedCell)} />
                  {qtyChanged && <span className="mt-0.5 block text-[10px] text-amber-600">was {o!.quantity}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10.5px] text-surface-500">Unit Price</span>
                  <input type="number" min={0} value={line.unitPrice} onChange={(e) => update(line.id, { unitPrice: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', priceChanged && changedCell)} />
                  {priceChanged && <span className="mt-0.5 block text-[10px] text-amber-600">was {formatINR(o!.unitPrice)}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10.5px] text-surface-500">Disc %</span>
                  <input type="number" min={0} max={100} value={line.discountPct} onChange={(e) => update(line.id, { discountPct: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', discChanged && changedCell)} />
                  {discChanged && <span className="mt-0.5 block text-[10px] text-amber-600">was {o!.discountPct}%</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10.5px] text-surface-500">GST %</span>
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
                <div className="grid grid-cols-1 gap-2 border-t border-surface-100 bg-surface-50/50 px-2.5 py-2.5 sm:grid-cols-2">
                  {TECH_SPEC_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-0.5 block text-[10.5px] text-surface-500">{f.label}</span>
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
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-200">
      <div className="flex items-center justify-between gap-2 border-b border-surface-100 px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-600">{icon}</span>
          <span className="text-surface-400">{n}.</span> {label}
        </h4>
        {action}
      </div>
      <div className="space-y-2.5 p-3">{children}</div>
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
        '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[12px] font-medium transition-colors',
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
  so,
  title,
  lines,
  specs,
  showSpecs,
  billing,
  shipping,
  deliveryDate,
  paymentText,
  deliveryTerms,
  kindAttention,
  officeId,
  poNumber,
  packingPct,
}: {
  open: boolean;
  onClose: () => void;
  so: SalesOrder;
  title: string;
  lines: LineItem[];
  specs: Record<string, TechnicalSpecs>;
  showSpecs: boolean;
  billing: string;
  shipping: string;
  deliveryDate: string;
  paymentText: string;
  deliveryTerms: string;
  kindAttention: string;
  officeId: string;
  poNumber: string;
  packingPct: number;
}) {
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      subtitle={`${so.number} · ${so.customerName}`}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <DocumentLetterhead
          docTitle="Sales Order Acknowledgement"
          meta={<p className="font-semibold text-surface-800">{so.number}</p>}
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-bold text-surface-900">{so.customerName}</h3>
            <p className="text-[12px] text-surface-500">{kindAttention}</p>
            <p className="mt-1 max-w-xs text-[11px] text-surface-400">{billing}</p>
            {shipping && shipping !== billing && (
              <p className="mt-1 max-w-xs text-[11px] text-surface-400">Ship to: {shipping}</p>
            )}
          </div>
          <div className="text-right text-[12px]">
            <p className="text-[13px] font-bold text-surface-900">{so.number}</p>
            <p className="mt-1 text-surface-500">PO: <span className="font-medium text-surface-800">{poNumber}</span></p>
            <p className="text-surface-500">Office: <span className="font-medium text-surface-800">{officeName(officeId)}</span></p>
            <p className="text-surface-500">Delivery: <span className="font-medium text-surface-800">{deliveryDate ? formatDate(deliveryDate, { short: true }) : '—'}</span></p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-surface-200">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {lines.map((it) => (
                <tr key={it.id} className="align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-surface-800">{it.description || '—'}</p>
                    <p className="text-[10.5px] text-surface-400">{it.itemCode}{it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}</p>
                    {showSpecs && specs[it.id] && (
                      <p className="mt-0.5 text-[10.5px] text-surface-500">
                        {[specs[it.id].make, specs[it.id].model, specs[it.id].operatingPressure].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                  <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-0.5 text-[11.5px] text-surface-600">
            <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-800">{paymentText}</span></p>
            <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-800">{deliveryTerms || '—'}</span></p>
          </div>
          <div className="ml-auto w-full max-w-xs space-y-0.5">
            <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
            <InfoRow label="GST" value={formatINR(totals.tax)} />
            <InfoRow label="Packing & Forwarding" value={formatINR(packingAmount)} />
            <div className="mt-1 flex items-center justify-between border-t border-surface-200 pt-2">
              <span className="text-[13px] font-semibold text-surface-800">Grand Total</span>
              <span className="text-[15px] font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
        <p className="text-[11px] italic text-surface-500">{amountInWords(totals.grandTotal)}</p>
      </div>
    </Modal>
  );
}
