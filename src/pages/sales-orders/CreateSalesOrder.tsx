import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User2,
  FileText,
  Boxes,
  Receipt,
  Calculator,
  Save,
  Eye,
  CheckCircle2,
  Download,
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
  InfoRow,
  StatusBadge,
  type UploadedFile,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS } from '@/data/users';
import type { CommercialTerms, LineItem, PaymentTerms, SalesOrder } from '@/types';
import { computeTotals, downloadText, formatINR, classNames } from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';

interface FormState {
  useNewCustomer: boolean;
  partyId: string;
  newCustomerName: string;
  contactPerson: string;
  gstin: string;
  billingAddress: string;
  shippingAddress: string;
  poNumber: string;
  poDate: string;
  quotationId: string;
  officeId: string;
  owner: string;
  packingPct: number;
  deliveryTerms: string;
  warrantyYears: number;
  payment: PaymentTerms;
  expectedDelivery: string;
}

// Commercial-terms defaults are sourced from T&C Master (the single source of
// truth) — never hardcoded here.
const initialForm = (officeId: string, ct: CommercialTerms): FormState => ({
  useNewCustomer: false,
  partyId: '',
  newCustomerName: '',
  contactPerson: '',
  gstin: '',
  billingAddress: '',
  shippingAddress: '',
  poNumber: '',
  poDate: '',
  quotationId: '',
  officeId,
  owner: OWNERS[0],
  packingPct: ct.packingPct,
  deliveryTerms: defaultDeliveryOption(ct)?.name ?? '',
  warrantyYears: ct.warrantyYears,
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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const scopedParties = useMemo(
    () => parties.filter((p) => (role === 'super_admin' ? true : p.officeId === currentUser.officeId)),
    [parties, role, currentUser]
  );
  const scopedQuotations = useMemo(
    () => quotations.filter((q) => q.officeId === form.officeId),
    [quotations, form.officeId]
  );

  const selectedParty = parties.find((p) => p.id === form.partyId);

  // When selecting an existing party, prefill address fields
  const onSelectParty = (id: string) => {
    const p = parties.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      partyId: id,
      billingAddress: p?.billingAddress ?? '',
      shippingAddress: p?.shippingAddress ?? '',
      gstin: p?.gstin ?? '',
      contactPerson: p?.contactPerson ?? '',
      officeId: p?.officeId ?? f.officeId,
    }));
  };

  const onSelectQuotation = (id: string) => {
    const q = quotations.find((x) => x.id === id);
    if (q) {
      setLines(q.items.map((it) => ({ ...it, id: `soln-${it.id}` })));
      // Commercial terms stay driven by T&C Master defaults (single source of
      // truth); linking a quotation only prefills its items & customer.
      setForm((f) => ({
        ...f,
        quotationId: id,
        partyId: q.partyId,
        billingAddress: parties.find((p) => p.id === q.partyId)?.billingAddress ?? f.billingAddress,
        shippingAddress: parties.find((p) => p.id === q.partyId)?.shippingAddress ?? f.shippingAddress,
        gstin: parties.find((p) => p.id === q.partyId)?.gstin ?? f.gstin,
        contactPerson: parties.find((p) => p.id === q.partyId)?.contactPerson ?? f.contactPerson,
      }));
    } else {
      set('quotationId', id);
    }
  };

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
    if (!form.contactPerson.trim()) e.contactPerson = 'Contact person is required';
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    if (!form.poNumber.trim()) e.poNumber = 'PO number is required';
    if (!form.poDate) e.poDate = 'PO date is required';
    if (!form.officeId) e.officeId = 'Sales office is required';
    if (!form.expectedDelivery) e.expectedDelivery = 'Expected delivery date is required';
    if (paymentSum !== 100) e.payment = 'Payment terms must total 100%';
    if (lines.length === 0) e.lines = 'Add at least one line item';
    else if (lines.some((l) => !l.itemId)) e.lines = 'Every line must have an item selected';
    else if (lines.some((l) => l.quantity <= 0)) e.lines = 'Quantities must be greater than 0';
    setErrors(e);
    if (Object.keys(e).length) {
      addToast({ type: 'error', title: 'Please fix the highlighted fields', message: `${Object.keys(e).length} field(s) need attention.` });
    }
    return Object.keys(e).length === 0;
  };

  const buildSO = (status: 'draft' | 'so_sent'): SalesOrder => {
    const q = quotations.find((x) => x.id === form.quotationId);
    const paymentTermsText = formatPaymentTerms(form.payment);
    const warrantyText = formatWarranty(form.warrantyYears);
    return {
      id: `so-${Date.now()}`,
      number: `SO/2026/${String(600 + Math.floor(Math.random() * 399)).padStart(4, '0')}`,
      poNumber: form.poNumber,
      poDate: form.poDate,
      quotationId: form.quotationId || undefined,
      quotationNumber: q?.number,
      partyId: form.partyId,
      customerName: customerName,
      customerCode: selectedParty?.code ?? 'NEW',
      officeId: form.officeId,
      owner: form.owner,
      value: totals.grandTotal,
      poValue: totals.grandTotal,
      quoteValue: q ? q.value : totals.grandTotal,
      status,
      verificationStatus: form.quotationId ? 'verified' : 'pending',
      receivedDate: form.poDate,
      createdDate: '2026-08-13',
      deliveryDate: form.expectedDelivery,
      billingAddress: form.billingAddress,
      shippingAddress: form.shippingAddress,
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
            shippingAddress: form.shippingAddress,
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
        { id: `act-${Date.now()}-created`, date: '2026-08-13T09:00:00', actor: form.owner, action: 'Sales Order created', detail: q ? `From quotation ${q.number}` : 'Created manually' },
      ],
      verificationFields: [],
    };
  };

  const saveDraft = () => {
    if (!form.poNumber.trim() && !form.partyId && !form.newCustomerName) {
      addToast({ type: 'warning', title: 'Nothing to save', message: 'Fill in at least the PO number and customer.' });
      return;
    }
    const so = buildSO('draft');
    addSalesOrder(so);
    addToast({ type: 'success', title: 'Draft saved', message: `${so.number} saved as draft.` });
    navigate('/sales-orders');
  };

  const createSO = () => {
    if (!validate()) return;
    const so = buildSO('so_sent');
    addSalesOrder(so);
    addToast({ type: 'success', title: 'Sales Order created', message: `${so.number} created for ${customerName}.` });
    navigate('/sales-orders');
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
        description="Build a sales order from a customer PO, optionally linked to an accepted quotation."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Create SO Manually' }]}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
            <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Preview</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={createSO}>Create SO</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* 1. Customer */}
          <SectionCard title={<Section icon={<User2 className="h-4 w-4" />} n={1} label="Customer Details" />}>
            <div className="mb-4 flex gap-2 rounded-lg bg-surface-100 p-1">
              <ToggleTab active={!form.useNewCustomer} onClick={() => set('useNewCustomer', false)}>Existing Customer</ToggleTab>
              <ToggleTab active={form.useNewCustomer} onClick={() => set('useNewCustomer', true)}>Add New Customer</ToggleTab>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {form.useNewCustomer ? (
                <TextField wrapClassName="sm:col-span-2" label="Company Name" required value={form.newCustomerName} error={errors.newCustomerName} onChange={(e) => set('newCustomerName', e.target.value)} placeholder="New customer name" />
              ) : (
                <SelectField
                  wrapClassName="sm:col-span-2"
                  label="Select Customer"
                  required
                  value={form.partyId}
                  error={errors.partyId}
                  onChange={(e) => onSelectParty(e.target.value)}
                  options={scopedParties.map((p) => ({ value: p.id, label: `${p.companyName} (${p.code})` }))}
                  placeholder="Select existing customer…"
                />
              )}
              <TextField label="Contact Person" required value={form.contactPerson} error={errors.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
              <TextField label="GSTIN" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="27AAACR5055K1Z5" />
              <TextAreaField wrapClassName="sm:col-span-2" label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />
              <TextAreaField wrapClassName="sm:col-span-2" label="Shipping Address" rows={2} value={form.shippingAddress} onChange={(e) => set('shippingAddress', e.target.value)} hint="Leave blank if same as billing" />
            </div>
          </SectionCard>

          {/* 2. Reference */}
          <SectionCard title={<Section icon={<FileText className="h-4 w-4" />} n={2} label="Reference Details" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="PO Number" required value={form.poNumber} error={errors.poNumber} onChange={(e) => set('poNumber', e.target.value)} placeholder="e.g. PO-1001-0700" />
              <TextField label="PO Date" required type="date" value={form.poDate} error={errors.poDate} onChange={(e) => set('poDate', e.target.value)} />
              <SelectField
                label="Linked Quotation (optional)"
                value={form.quotationId}
                onChange={(e) => onSelectQuotation(e.target.value)}
                options={scopedQuotations.map((q) => ({ value: q.id, label: `${q.number} — ${q.customerName}` }))}
                placeholder="No linked quotation"
                hint="Selecting a quotation prefills its items & terms"
              />
              <SelectField label="Sales Office" required value={form.officeId} error={errors.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === currentUser.officeId)).map((o) => ({ value: o.id, label: o.name }))} />
              <SelectField label="Owner" required value={form.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} />
              <div className="sm:col-span-2">
                <label className="label">Upload PO Proof</label>
                <FileUpload files={poFiles} onChange={setPoFiles} label="Upload customer PO document" multiple={false} />
              </div>
            </div>
          </SectionCard>

          {/* 3. Items */}
          <SectionCard
            title={<Section icon={<Boxes className="h-4 w-4" />} n={3} label="Items" />}
            action={<span className="text-xs text-surface-400">{lines.length} line item(s)</span>}
          >
            <ItemLineEditor items={lines} catalog={items} onChange={setLines} />
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
              <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} error={errors.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} />
              <SelectField
                wrapClassName="sm:col-span-2"
                label="Delivery Terms"
                value={form.deliveryTerms}
                onChange={(e) => set('deliveryTerms', e.target.value)}
                options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))}
                placeholder="Select delivery option"
              />
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
                      <p className="mt-1 text-[11px] text-surface-500">{f.label}</p>
                    </div>
                  ))}
                </div>
                <div className={classNames('mt-2 text-xs font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                  Total: {paymentSum}%{paymentSum !== 100 && ' — must total 100%'}
                </div>
                {errors.payment && <p className="mt-1 text-xs font-medium text-rose-600">{errors.payment}</p>}
              </div>
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
                <Button variant="primary" className="w-full" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={createSO}>Create Sales Order</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
                  <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadDraft}>Download</Button>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

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
            <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setPreview(false); createSO(); }}>Create SO</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold text-surface-900">{customerName || 'Customer'}</h3>
              <p className="text-sm text-surface-500">{form.contactPerson}</p>
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
