import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Eye,
  FilePlus2,
  FileSearch,
  Link2,
  SearchX,
  ShieldAlert,
} from 'lucide-react';
import type { InboxEmail, Quotation } from '@/types';
import { Button, Drawer, EmptyState, Modal, SearchInput, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { formatDate, formatINR, lineTotal } from '@/lib/format';
import { QUOTATION_STAGE } from '@/lib/labels';
import {
  associationEmailPatch,
  buildVerificationSalesOrder,
  candidateQuotations,
  quotationRefOf,
  verificationSoId,
} from '@/lib/poAssociation';

/**
 * Right-panel workflow for a Purchase Order email that is not yet associated
 * with a quotation. The cited quotation number found no exact match in the
 * register, so the user must pick from the customer's quotations of the last
 * one year (search + preview + Associate Quotation) — or, when no valid
 * quotation exists, create the Sales Order manually. Association is always an
 * explicit action here: the customer name alone never auto-associates.
 */
export function PoAssociationPanel({ email }: { email: InboxEmail }) {
  const { quotations, salesOrders, parties, addSalesOrder, updateEmail, addToast, currentUser } = useApp();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<Quotation | null>(null);

  const citedRef = quotationRefOf(email);
  const candidates = useMemo(() => candidateQuotations(email, quotations), [email, quotations]);

  const filteredCandidates = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return candidates;
    return candidates.filter((q) =>
      `${q.number} ${q.stage} ${q.status} ${formatINR(q.value)}`.toLowerCase().includes(s)
    );
  }, [candidates, search]);

  const associate = (quote: Quotation) => {
    const soId = verificationSoId(email.id);
    let so = salesOrders.find((s) => s.id === soId);
    if (!so) {
      so = buildVerificationSalesOrder({
        email,
        quote,
        parties,
        salesOrders,
        association: { kind: 'manual', by: currentUser.fullName },
      });
      addSalesOrder(so);
    }
    updateEmail(email.id, associationEmailPatch(email, quote, so));
    addToast({
      type: 'success',
      title: 'Quotation associated',
      message: `${quote.number} linked to ${email.linkedPO ?? 'this PO'} — PO vs Quote verification started.`,
    });
    setPreview(null);
    setDrawerOpen(false);
  };

  const createManually = () => navigate('/sales-orders/create');

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="amber" label="Association Required" />
          <span className="text-[11px] font-semibold text-surface-400">{email.linkedPO ?? ''}</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-700">{email.customerName ?? email.senderName}</span></p>
          <p>
            <span className="text-surface-400">Quotation cited in PO:</span>{' '}
            {citedRef ? (
              <span className="font-semibold text-surface-800">{citedRef}</span>
            ) : (
              <span className="font-medium text-surface-500">None mentioned</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <div className="flex items-start gap-2">
            <FileSearch className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <div className="text-[12px] text-amber-800">
              <p className="font-semibold">No matching quotation found</p>
              <p className="mt-0.5">
                {citedRef
                  ? `The quotation number “${citedRef}” cited in this Purchase Order does not exist in the quotation register.`
                  : 'This Purchase Order does not mention a quotation number.'}{' '}
                Associate the correct quotation manually to start PO vs Quote verification.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-surface-200 bg-surface-50/60 p-3 text-[12px] text-surface-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-surface-400" />
          <p>
            Quotations are never associated automatically from the customer name alone — only an exact
            quotation-number match or your explicit selection links a quote to this PO.
          </p>
        </div>

        <div className="rounded-xl border border-surface-200 p-3">
          <p className="text-[12px] font-semibold text-surface-800">
            {candidates.length > 0
              ? `${candidates.length} quotation${candidates.length === 1 ? '' : 's'} for this customer in the last one year`
              : 'No quotations for this customer in the last one year'}
          </p>
          <p className="mt-0.5 text-[11px] text-surface-500">
            {candidates.length > 0
              ? 'Search, preview and pick the quotation this Purchase Order was issued against.'
              : 'There is no valid quotation to verify this PO against — create the Sales Order manually instead.'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {candidates.length > 0 && (
              <Button variant="primary" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => setDrawerOpen(true)}>
                Associate Quotation
              </Button>
            )}
            <Button
              variant={candidates.length > 0 ? 'secondary' : 'primary'}
              leftIcon={<FilePlus2 className="h-4 w-4" />}
              onClick={createManually}
            >
              Create SO Manually
            </Button>
          </div>
        </div>
      </div>

      {/* Associate Quotation drawer — the customer's last-one-year quotations */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width="xl"
        title="Associate Quotation"
        subtitle={
          <span>
            {email.customerName ?? email.senderName} · quotations from the last one year · PO {email.linkedPO ?? ''}
          </span>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" leftIcon={<FilePlus2 className="h-4 w-4" />} onClick={createManually}>
              Create SO Manually
            </Button>
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</Button>
          </div>
        }
      >
        <div className="space-y-3 pt-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Search quote number, stage, value…" className="w-full sm:w-80" />
          {filteredCandidates.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                    <th className="px-3 py-2 text-left">Quote Number</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-left">Stage</th>
                    <th className="px-3 py-2 text-left">Latest Sent Date</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {filteredCandidates.map((q) => {
                    const stage = QUOTATION_STAGE[q.stage];
                    return (
                      <tr key={q.id} className="hover:bg-surface-50/60">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-surface-800">{q.number}</p>
                          <p className="text-[11px] text-surface-400">{q.items.length} line item{q.items.length === 1 ? '' : 's'}</p>
                        </td>
                        <td className="px-3 py-2 text-surface-700">
                          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-surface-300" /> {formatDate(q.quoteDate, { short: true })}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(q.value)}</td>
                        <td className="px-3 py-2"><StatusBadge tone={stage.tone} label={stage.label} /></td>
                        <td className="px-3 py-2 text-surface-700">{q.sentAt ? formatDate(q.sentAt.slice(0, 10), { short: true }) : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="ghost" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreview(q)}>
                              Preview
                            </Button>
                            <Button variant="primary" size="sm" leftIcon={<Link2 className="h-3.5 w-3.5" />} onClick={() => associate(q)}>
                              Associate Quotation
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6">
              <EmptyState
                icon={<SearchX className="h-7 w-7" />}
                title={candidates.length === 0 ? 'No quotations in the last one year' : 'No quotations match your search'}
                message={
                  candidates.length === 0
                    ? 'This customer has no quotations from the last one year to verify the PO against. Create the Sales Order manually.'
                    : 'Try a different quote number or clear the search.'
                }
              />
              {candidates.length === 0 && (
                <div className="mt-3 flex justify-center">
                  <Button variant="primary" leftIcon={<FilePlus2 className="h-4 w-4" />} onClick={createManually}>
                    Create SO Manually
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>

      {/* Quotation preview */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        size="lg"
        title="Quotation Preview"
        subtitle={preview ? `${preview.number} · ${preview.customerName}` : undefined}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>Close</Button>
            {preview && (
              <Button variant="primary" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => associate(preview)}>
                Associate Quotation
              </Button>
            )}
          </div>
        }
      >
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Quote Date</p>
                <p className="mt-0.5 text-surface-800">{formatDate(preview.quoteDate, { short: true })}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Latest Sent</p>
                <p className="mt-0.5 text-surface-800">{preview.sentAt ? formatDate(preview.sentAt.slice(0, 10), { short: true }) : '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Stage</p>
                <p className="mt-0.5"><StatusBadge tone={QUOTATION_STAGE[preview.stage].tone} label={QUOTATION_STAGE[preview.stage].label} /></p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Owner</p>
                <p className="mt-0.5 text-surface-800">{preview.owner}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-surface-200">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {preview.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description}</p><p className="text-[11px] text-surface-400">{it.itemCode}</p></td>
                      <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                      <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
                <span className="text-[12px] font-medium text-surface-600">Quotation Value</span>
                <span className="text-[14px] font-bold text-surface-900">{formatINR(preview.value)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
