import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User2,
  FileText,
  Boxes,
  Receipt,
  Calculator,
  Save,
  Eye,
  Send,
  Download,
  Upload,
  Phone,
  MessageSquare,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  SectionCard,
  TextField,
  SelectField,
  TextAreaField,
  ItemLineEditor,
  FileUpload,
  Modal,
  ConfirmDialog,
  InfoRow,
  StatusBadge,
  Toggle,
  type UploadedFile,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS, USERS } from '@/data/users';
import type { CommercialTerms, LineItem, PaymentTerms, PoProofType, SalesOrder } from '@/types';
import { computeTotals, downloadText, formatINR, classNames } from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';

// Clearer, spec-aligned labels for the four payment buckets (the shared
// PAYMENT_FIELDS keys/order are reused; only display labels differ here).
const PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

const PO_PROOF_OPTIONS: { value: PoProofType; label: string; icon: typeof Upload }[] = [
  { value: 'uploaded', label: 'Uploaded PO Document', icon: Upload },
  { value: 'phone_call', label: 'Phone Call', icon: Phone },
  { value: 'message', label: 'Message / WhatsApp', icon: MessageSquare },
];

interface FormState {
  useNewCustomer: boolean;
  partyId: string;
  newCustomerName: string;
  billingAddress: string;
  shippingAddress: string;
  sameAsBilling: boolean;
  phone: string;
  email: string;
  pincode: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionEmail: string;
  poNumber: string;
  poDate: string;
  quotationId: string;
  officeId: string;
  owner: string;
  officeAdmin: string;
  poProofType: PoProofType;
  poProofNotes: string;
  packingPct: number;
  deliveryTerms: string;
  warrantyYears: number;
  creditDays: number;
  payment: PaymentTerms;
  expectedDelivery: string;
}

// Commercial-terms defaults are sourced from T&C Master (the single source of
// truth) — never hardcoded here.
const initialForm = (officeId: string, ct: CommercialTerms): FormState => ({
  useNewCustomer: false,
  partyId: '',
  newCustomerName: '',
  billingAddress: '',
  shippingAddress: '',
  sameAsBilling: false,
  phone: '',
  email: '',
  pincode: '',
  gstin: '',
  kindAttentionName: '',
  kindAttentionEmail: '',
  poNumber: '',
  poDate: '',
  quotationId: '',
  officeId,
  owner: OWNERS[0],
  officeAdmin: '',
  poProofType: 'uploaded',
  poProofNotes: '',
  packingPct: ct.packingPct,
  deliveryTerms: defaultDeliveryOption(ct)?.name ?? '',
  warrantyYears: ct.warrantyYears,
  creditDays: 0,
  payment: { ...ct.payment },
  expectedDelivery: '',
});

export default function CreateSalesOrder() {
  const { parties, items, quotations, commercialTerms, role, currentUser, addSalesOrder, addToast } = useApp();
  const navigate = useNavigate();

  const defaultOffice = role === 'super_admin' ? OFFICES[0].id : currentUser.officeId;
  const [form, setForm] = useState<FormState>(() => initialForm(defaultOffice, commercialTerms));
  const deliveryChoices = useMemo(() => activeDeliveryOptions(commercialTerms), [commercialTerms]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [poFiles, setPoFiles] = useState<UploadedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [pendingQuotationId, setPendingQuotationId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const setLinesTracked = (next: LineItem[]) => {
    setLines(next);
    setDirty(true);
  };

  // Warn before leaving the page (tab close / reload) with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const scopedParties = useMemo(
    () => parties.filter((p) => (role === 'super_admin' ? true : p.officeId === currentUser.officeId)),
    [parties, role, currentUser]
  );
  // Quotations are limited to the chosen office and, once an existing customer
  // is picked, to that customer — so a linked quote always belongs to them.
  const scopedQuotations = useMemo(
    () => quotations.filter((q) => q.officeId === form.officeId && (!form.partyId || q.partyId === form.partyId)),
    [quotations, form.officeId, form.partyId]
  );

  const officeAdmins = useMemo(() => {
    const inOffice = USERS.filter((u) => u.role === 'office_admin' && u.officeId === form.officeId && u.active);
    const list = inOffice.length ? inOffice : USERS.filter((u) => u.role === 'office_admin' && u.active);
    return list.map((u) => u.fullName);
  }, [form.officeId]);

  const selectedParty = parties.find((p) => p.id === form.partyId);

  // When selecting an existing party, prefill from Party Master.
  const onSelectParty = (id: string) => {
    const p = parties.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      partyId: id,
      quotationId: '',
      billingAddress: p?.billingAddress ?? '',
      shippingAddress: p?.shippingAddress ?? '',
      sameAsBilling: false,
      phone: p?.phone ?? '',
      email: p?.email ?? '',
      gstin: p?.gstin ?? '',
      kindAttentionName: p?.contactPerson ?? '',
      kindAttentionEmail: p?.email ?? '',
      officeId: p?.officeId ?? f.officeId,
    }));
    setDirty(true);
  };

  const applyQuotation = (id: string) => {
    const q = quotations.find((x) => x.id === id);
    if (!q) {
      set('quotationId', id);
      return;
    }
    setLines(q.items.map((it) => ({ ...it, id: `soln-${it.id}` })));
    const party = parties.find((p) => p.id === q.partyId);
    // Linking a quotation prefills its items, customer, sales office and owner.
    // Commercial terms stay driven by T&C Master defaults (single source of truth).
    setForm((f) => ({
      ...f,
      quotationId: id,
      partyId: q.partyId,
      officeId: q.officeId || f.officeId,
      owner: q.owner || f.owner,
      billingAddress: party?.billingAddress ?? f.billingAddress,
      shippingAddress: party?.shippingAddress ?? f.shippingAddress,
      phone: party?.phone ?? f.phone,
      email: party?.email ?? f.email,
      gstin: party?.gstin ?? f.gstin,
      kindAttentionName: party?.contactPerson ?? f.kindAttentionName,
      kindAttentionEmail: party?.email ?? f.kindAttentionEmail,
    }));
    setDirty(true);
  };

  // Guard against silently overwriting manually-entered items.
  const onSelectQuotation = (id: string) => {
    if (id && lines.length > 0) {
      setPendingQuotationId(id);
      return;
    }
    applyQuotation(id);
  };

  // Keep shipping mirrored to billing while "same as billing" is on.
  const effectiveShipping = form.sameAsBilling ? form.billingAddress : form.shippingAddress;

  // Packing is a % of the taxable order value; convert to an absolute amount so
  // the shared computeTotals math is unchanged.
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * form.packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  const paymentSum = paymentTotal(form.payment);
  const customerName = form.useNewCustomer ? form.newCustomerName : selectedParty?.companyName ?? '';

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.useNewCustomer) {
      if (!form.newCustomerName.trim()) e.newCustomerName = 'Customer name is required';
    } else if (!form.partyId) {
      e.partyId = 'Select a customer';
    }
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    if (!form.phone.trim() && !form.email.trim()) e.phone = 'Provide a phone number or email';
    if (!form.gstin.trim()) e.gstin = 'GSTIN is required';
    if (!form.kindAttentionName.trim()) e.kindAttentionName = 'Kind attention name is required';

    if (!form.poNumber.trim()) e.poNumber = 'PO number is required';
    if (!form.poDate) e.poDate = 'PO date is required';
    if (!form.officeId) e.officeId = 'Sales office is required';
    if (!form.owner) e.owner = 'Owner is required';

    // PO proof — required evidence depends on how the PO arrived.
    if (form.poProofType === 'uploaded' && poFiles.length === 0) e.poProof = 'Upload the PO document';
    if (form.poProofType === 'phone_call' && !form.poProofNotes.trim()) e.poProof = 'Add proof notes for the phone call';
    if (form.poProofType === 'message' && poFiles.length === 0) e.poProof = 'Upload the message / WhatsApp screenshot';

    if (!form.expectedDelivery) e.expectedDelivery = 'Expected delivery date is required';
    if (paymentSum !== 100) e.payment = 'Payment terms must total 100%.';

    if (lines.length === 0) e.lines = 'Add at least one line item';
    else if (lines.some((l) => !l.itemId)) e.lines = 'Every line must have an item selected';
    else if (lines.some((l) => l.quantity <= 0)) e.lines = 'Quantities must be greater than 0';
    else if (lines.some((l) => l.unitPrice <= 0)) e.lines = 'Unit price must be greater than 0';

    setErrors(e);
    if (Object.keys(e).length) {
      addToast({ type: 'error', title: 'Please fix the highlighted fields', message: `${Object.keys(e).length} field(s) need attention.` });
    }
    return Object.keys(e).length === 0;
  };

  const buildSO = (opts: { withHandoff: boolean }): SalesOrder => {
    const q = quotations.find((x) => x.id === form.quotationId);
    const paymentTermsText =
      formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');
    const warrantyText = formatWarranty(form.warrantyYears);
    const now = new Date().toISOString();
    const shipping = effectiveShipping;
    return {
      id: `so-${Date.now()}`,
      number: `SO/2026/${String(600 + Math.floor(Math.random() * 399)).padStart(4, '0')}`,
      poNumber: form.poNumber,
      poDate: form.poDate,
      quotationId: form.quotationId || undefined,
      quotationNumber: q?.number,
      partyId: form.partyId,
      customerName,
      customerCode: selectedParty?.code ?? 'NEW',
      officeId: form.officeId,
      owner: form.owner,
      value: totals.grandTotal,
      poValue: totals.grandTotal,
      quoteValue: q ? q.value : totals.grandTotal,
      status: opts.withHandoff ? 'so_sent' : 'draft',
      verificationStatus: form.quotationId ? 'verified' : 'pending',
      receivedDate: form.poDate,
      createdDate: '2026-08-13',
      deliveryDate: form.expectedDelivery,
      billingAddress: form.billingAddress,
      shippingAddress: shipping,
      customerPhone: form.phone || undefined,
      customerEmail: form.email || undefined,
      pincode: form.pincode || undefined,
      kindAttentionName: form.kindAttentionName || undefined,
      kindAttentionEmail: form.kindAttentionEmail || undefined,
      officeAdmin: form.officeAdmin || undefined,
      poProofType: form.poProofType,
      poProofNotes: form.poProofNotes || undefined,
      sentAt: opts.withHandoff ? now : undefined,
      erpHandoff: opts.withHandoff ? { state: 'pending', submittedAt: now, submittedBy: currentUser.fullName } : undefined,
      revisionNumber: 0,
      revisionAttachments: [],
      versions: [
        {
          id: `ver-${Date.now()}-0`,
          label: 'Original',
          version: 0,
          createdAt: '2026-08-13T09:00:00',
          by: form.owner,
          reason: 'Initial sales order',
          snapshot: {
            items: lines.map((it) => ({ ...it })),
            paymentTerms: paymentTermsText,
            deliveryTerms: form.deliveryTerms,
            deliveryDate: form.expectedDelivery,
            billingAddress: form.billingAddress,
            shippingAddress: shipping,
          },
          attachments: [],
        },
      ],
      items: lines,
      paymentTerms: paymentTermsText,
      deliveryTerms: form.deliveryTerms,
      warranty: warrantyText,
      packingCharges: packingAmount,
      internalNotes: [],
      activity: [
        { id: `act-${Date.now()}-created`, date: now, actor: form.owner, action: 'Sales Order created', detail: q ? `From quotation ${q.number}` : 'Created manually' },
        ...(opts.withHandoff
          ? [{ id: `act-${Date.now()}-erp`, date: now, actor: currentUser.fullName, action: 'Submitted to ERP Handoff', detail: 'Pending manufacturing handover' }]
          : []),
      ],
      verificationFields: [],
    };
  };

  // Save Draft keeps the user on the form with values intact. It intentionally
  // does NOT create a Sales Order / ERP Handoff record or generate a final SO
  // number — only "Create & Submit" does.
  const saveDraft = () => {
    addToast({ type: 'success', title: 'Draft saved', message: 'Sales Order draft saved.' });
    setDirty(false);
  };

  const attemptCreate = () => {
    if (!validate()) return;
    setConfirmCreate(true);
  };

  const doCreateAndSubmit = () => {
    const so = buildSO({ withHandoff: true });
    setDirty(false);
    addSalesOrder(so);
    addToast({ type: 'success', title: 'Sales Order created', message: 'Sales Order created and submitted to ERP Handoff.' });
    navigate('/erp-handoff', { state: { highlightId: so.id } });
  };

  const downloadDraft = () => {
    downloadText(
      `SO-draft-${form.poNumber || 'new'}.txt`,
      `DRAFT SALES ORDER\nCustomer: ${customerName}\nPO: ${form.poNumber}\nValue: ${formatINR(totals.grandTotal)}\nItems: ${lines.length}`
    );
    addToast({ type: 'info', title: 'Draft downloaded', message: 'SO draft exported.' });
  };

  return (
    <>
      <PageHeader
        title="Create Sales Order Manually"
        description="Build a sales order from a customer PO, optionally linked to an accepted quotation, then submit it to ERP Handoff."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Create SO Manually' }]}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
            <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Preview</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={attemptCreate}>Create SO &amp; Submit to ERP Handoff</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* 1. Client Details */}
          <SectionCard title={<Section icon={<User2 className="h-4 w-4" />} n={1} label="Client Details" />}>
            <div className="mb-4 flex gap-2 rounded-lg bg-surface-100 p-1">
              <ToggleTab active={!form.useNewCustomer} onClick={() => set('useNewCustomer', false)}>Existing Customer</ToggleTab>
              <ToggleTab active={form.useNewCustomer} onClick={() => set('useNewCustomer', true)}>Add New Customer</ToggleTab>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {form.useNewCustomer ? (
                <TextField wrapClassName="sm:col-span-2" label="Customer / Party" required value={form.newCustomerName} error={errors.newCustomerName} onChange={(e) => set('newCustomerName', e.target.value)} placeholder="New customer name" hint="New customers are not added to Party Master automatically." />
              ) : (
                <SelectField
                  wrapClassName="sm:col-span-2"
                  label="Customer / Party"
                  required
                  value={form.partyId}
                  error={errors.partyId}
                  onChange={(e) => onSelectParty(e.target.value)}
                  options={scopedParties.map((p) => ({ value: p.id, label: `${p.companyName} (${p.code})` }))}
                  placeholder="Select existing customer…"
                />
              )}
              <TextField label="Phone" value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98200 41122" />
              <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="orders@customer.com" />
              <TextField label="GSTIN" required value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="27AAACR5055K1Z5" />
              <TextField label="Pincode" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} placeholder="400001" />
              <TextAreaField wrapClassName="sm:col-span-2" label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />
              <div className="sm:col-span-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="label mb-0">Shipping Address</label>
                  <label className="flex items-center gap-2 text-[12px] text-surface-500">
                    <Toggle checked={form.sameAsBilling} onChange={(v) => set('sameAsBilling', v)} />
                    Same as Billing Address
                  </label>
                </div>
                <TextAreaField label="" rows={2} value={effectiveShipping} disabled={form.sameAsBilling} onChange={(e) => set('shippingAddress', e.target.value)} placeholder={form.sameAsBilling ? 'Same as billing address' : 'Shipping address'} />
              </div>
              <TextField label="Kind Attention — Name" required value={form.kindAttentionName} error={errors.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} placeholder="Contact person" />
              <TextField label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} placeholder="contact@customer.com" />
            </div>
          </SectionCard>

          {/* 2. Order Details */}
          <SectionCard title={<Section icon={<FileText className="h-4 w-4" />} n={2} label="Order Details" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="PO Number" required value={form.poNumber} error={errors.poNumber} onChange={(e) => set('poNumber', e.target.value)} placeholder="e.g. PO-1001-0700" />
              <TextField label="PO Date" required type="date" value={form.poDate} error={errors.poDate} onChange={(e) => set('poDate', e.target.value)} />
              <SelectField
                label="Linked Quotation (optional)"
                value={form.quotationId}
                disabled={form.useNewCustomer}
                onChange={(e) => onSelectQuotation(e.target.value)}
                options={scopedQuotations.map((q) => ({ value: q.id, label: `${q.number} — ${q.customerName}` }))}
                placeholder={form.useNewCustomer ? 'Not available for new customers' : 'No linked quotation'}
                hint={form.useNewCustomer ? undefined : 'Prefills items, terms, office & owner'}
              />
              <SelectField label="Sales Office" required value={form.officeId} error={errors.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === currentUser.officeId)).map((o) => ({ value: o.id, label: o.name }))} />
              <SelectField label="Owner / Sales Person" required value={form.owner} error={errors.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} />
              <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" />

              {/* PO Proof */}
              <div className="sm:col-span-2">
                <label className="label">PO Proof Type</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PO_PROOF_OPTIONS.map((opt) => {
                    const OptIcon = opt.icon;
                    const active = form.poProofType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set('poProofType', opt.value)}
                        className={classNames(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition',
                          active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/30' : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                        )}
                      >
                        <OptIcon className="h-4 w-4 flex-none" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.poProofType !== 'phone_call' && (
                <div className="sm:col-span-2">
                  <label className="label">Upload Proof {form.poProofType === 'message' ? '(screenshot / document)' : '(PO document)'}</label>
                  <FileUpload files={poFiles} onChange={(f) => { setPoFiles(f); setDirty(true); }} label={form.poProofType === 'message' ? 'Upload message / WhatsApp screenshot' : 'Upload customer PO document'} multiple={false} />
                </div>
              )}
              <TextAreaField
                wrapClassName="sm:col-span-2"
                label={form.poProofType === 'phone_call' ? 'Proof Notes' : 'Proof Notes (optional)'}
                required={form.poProofType === 'phone_call'}
                rows={2}
                value={form.poProofNotes}
                onChange={(e) => set('poProofNotes', e.target.value)}
                placeholder={form.poProofType === 'phone_call' ? 'Who confirmed the PO by phone, when, and key details…' : 'Any additional context about the PO proof…'}
              />
              {errors.poProof && <p className="-mt-2 text-xs font-medium text-rose-600 sm:col-span-2">{errors.poProof}</p>}
            </div>
          </SectionCard>

          {/* 3. Catalogue Items */}
          <SectionCard
            title={<Section icon={<Boxes className="h-4 w-4" />} n={3} label="Catalogue Items" />}
            action={<span className="text-xs text-surface-400">{lines.length} line item(s)</span>}
          >
            <ItemLineEditor items={lines} catalog={items} onChange={setLinesTracked} />
            {errors.lines && <p className="mt-2 text-xs font-medium text-rose-600">{errors.lines}</p>}
          </SectionCard>

          {/* 4. Commercial Terms */}
          <SectionCard
            title={<Section icon={<Receipt className="h-4 w-4" />} n={4} label="Commercial Terms" />}
            action={<span className="text-xs text-surface-400">Defaults from T&amp;C Master</span>}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Packing (%)"
                type="number"
                min={0}
                max={100}
                value={form.packingPct}
                onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))}
                hint={`≈ ${formatINR(packingAmount)} on current items`}
              />
              <SelectField
                label="Delivery Terms"
                value={form.deliveryTerms}
                onChange={(e) => set('deliveryTerms', e.target.value)}
                options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))}
                placeholder="Select delivery option"
              />
              <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} error={errors.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} />
              <TextField
                label="Warranty (Years)"
                type="number"
                min={1}
                value={form.warrantyYears}
                onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))}
              />
              <div className="sm:col-span-2">
                <label className="label">Payment Terms</label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PAYMENT_FIELDS.map((f) => (
                    <div key={f.key}>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="input pr-8"
                          value={form.payment[f.key]}
                          onChange={(e) =>
                            set('payment', {
                              ...form.payment,
                              [f.key]: Math.max(0, Math.min(100, Number(e.target.value))),
                            })
                          }
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-surface-400">%</span>
                      </div>
                      <p className="mt-1 text-[11px] text-surface-500">{PAYMENT_LABEL[f.key]}</p>
                    </div>
                  ))}
                </div>
                <div className={classNames('mt-2 text-xs font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                  Total: {paymentSum}%{paymentSum !== 100 && ' — Payment terms must total 100%.'}
                </div>
                {errors.payment && <p className="mt-1 text-xs font-medium text-rose-600">{errors.payment}</p>}
              </div>
              <TextField
                label="Credit Days"
                type="number"
                min={0}
                value={form.creditDays}
                onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))}
                hint="Credit period in days (if applicable)"
              />
            </div>
          </SectionCard>
        </div>

        {/* 5. Summary (sticky) */}
        <div className="xl:col-span-1">
          <div className="sticky top-20 space-y-4">
            <SectionCard title={<Section icon={<Calculator className="h-4 w-4" />} n={5} label="Summary" />}>
              <div className="space-y-1">
                <InfoRow label="Customer" value={customerName || '—'} />
                <InfoRow label="Sales Office" value={officeName(form.officeId)} />
                <InfoRow label="Owner" value={form.owner || '—'} />
                <InfoRow label="PO Number" value={form.poNumber || '—'} />
                <InfoRow label="Line Items" value={String(lines.length)} />
                <div className="my-2 border-t border-surface-100" />
                <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
                <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
                <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
                <InfoRow label="GST" value={formatINR(totals.tax)} />
                <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
                <div className="mt-2 border-t border-surface-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-surface-800">Grand Total</span>
                    <span className="text-lg font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Button variant="primary" className="w-full" leftIcon={<Send className="h-4 w-4" />} onClick={attemptCreate}>Create SO &amp; Submit to ERP Handoff</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
                  <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadDraft}>Download</Button>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* Overwrite-guard when linking a quotation over manual items */}
      <ConfirmDialog
        open={!!pendingQuotationId}
        onClose={() => setPendingQuotationId(null)}
        onConfirm={() => { if (pendingQuotationId) applyQuotation(pendingQuotationId); setPendingQuotationId(null); }}
        title="Replace current items?"
        message="Linking this quotation will replace the items and customer details you've entered. Continue?"
        confirmLabel="Replace"
      />

      {/* Create & submit confirmation */}
      <ConfirmDialog
        open={confirmCreate}
        onClose={() => setConfirmCreate(false)}
        onConfirm={doCreateAndSubmit}
        title="Create Sales Order?"
        message="The Sales Order will be created and added to ERP Handoff for manufacturing processing."
        confirmLabel="Create & Submit"
      />

      {/* Preview modal */}
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Sales Order Preview"
        subtitle={form.poNumber ? `PO ${form.poNumber}` : 'Draft'}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(false)}>Close</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={() => { setPreview(false); attemptCreate(); }}>Create SO &amp; Submit to ERP Handoff</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-surface-900">{customerName || 'Customer'}</h3>
              <p className="text-sm text-surface-500">{form.kindAttentionName}</p>
              <p className="mt-1 max-w-sm text-xs text-surface-400">{form.billingAddress}</p>
            </div>
            <div className="text-right text-sm">
              <StatusBadge tone="blue" label="Draft Preview" dot={false} />
              <p className="mt-2 text-surface-500">PO: <span className="font-medium text-surface-800">{form.poNumber || '—'}</span></p>
              <p className="text-surface-500">Office: <span className="font-medium text-surface-800">{officeName(form.officeId)}</span></p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-surface-200">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                  <th className="px-3 py-2.5 text-left">Item</th>
                  <th className="px-2 py-2.5 text-right">Qty</th>
                  <th className="px-2 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {lines.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-surface-400">No items added.</td></tr>
                ) : (
                  lines.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2.5">{it.description || '—'}</td>
                      <td className="px-2 py-2.5 text-right">{it.quantity} {it.unit}</td>
                      <td className="px-2 py-2.5 text-right">{formatINR(it.unitPrice)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{formatINR(it.quantity * it.unitPrice * (1 - it.discountPct / 100))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1">
            <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
            <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
            <InfoRow label="GST" value={formatINR(totals.tax)} />
            <InfoRow label="Packing" value={formatINR(packingAmount)} />
            <div className="mt-1 border-t border-surface-200 pt-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-surface-800">Grand Total</span>
                <span className="text-base font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Section({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="text-surface-400">{n}.</span> {label}
    </span>
  );
}

function ToggleTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}
    >
      {children}
    </button>
  );
}
