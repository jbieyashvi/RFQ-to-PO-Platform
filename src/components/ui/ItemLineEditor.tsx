import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Sliders, Trash2 } from 'lucide-react';
import type { DeliveryScheduleRow, Item, ItemTechnical, LineItem, SoKeyValue } from '@/types';
import { formatINR, lineTotal, classNames } from '@/lib/format';
import { defaultItemTechnical, nextKvId } from '@/lib/technicalSpecs';
import { Button } from './Button';

let lineSeq = 0;

export function ItemLineEditor({
  items,
  catalog,
  onChange,
  expandable = false,
  defaultDeliveryDate,
}: {
  items: LineItem[];
  catalog: Item[];
  onChange: (lines: LineItem[]) => void;
  // Progressive disclosure — when on, each row gets an "Expand Details" action
  // opening the per-item Product / Delivery Schedule / Documents / Technical /
  // Accessories groups. Off by default so existing callers stay unchanged.
  expandable?: boolean;
  // Seeds the first delivery-schedule row's dates when an item is added/selected.
  defaultDeliveryDate?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const update = (id: string, patch: Partial<LineItem>) => {
    onChange(items.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const seedSchedule = (line: Pick<LineItem, 'id' | 'quantity'>): DeliveryScheduleRow[] => [
    {
      id: `${line.id}-sch-1`,
      scheduleNo: 1,
      deliveryDate: defaultDeliveryDate || undefined,
      expectedArrivalDate: defaultDeliveryDate || undefined,
      scheduledQty: line.quantity,
      pendingQty: line.quantity,
    },
  ];

  const onSelectItem = (id: string, itemId: string) => {
    const cat = catalog.find((c) => c.id === itemId);
    if (!cat) {
      update(id, {
        itemId: '', itemCode: '', itemName: '', description: '', hsnCode: '', unit: '', unitPrice: 0,
        technical: undefined, schedule: undefined,
      });
      return;
    }
    const line = items.find((l) => l.id === id);
    const patch: Partial<LineItem> = {
      itemId: cat.id,
      itemCode: cat.code,
      itemName: cat.name,
      description: cat.name,
      hsnCode: cat.hsnCode,
      unit: cat.unit,
      unitPrice: cat.unitPrice,
    };
    // Prefill the shared technical block from the Item Master and seed a default
    // delivery schedule row, but only when the user hasn't already edited them.
    if (line && !line.technical) {
      patch.technical = defaultItemTechnical({ ...line, ...patch } as LineItem, catalog);
    }
    if (line && (!line.schedule || !line.schedule.length)) {
      patch.schedule = seedSchedule({ id, quantity: line?.quantity ?? 1 });
    }
    update(id, patch);
  };

  const addLine = () => {
    const id = `newln-${++lineSeq}`;
    onChange([
      ...items,
      {
        id,
        itemId: '',
        itemCode: '',
        description: '',
        hsnCode: '',
        quantity: 1,
        unit: 'Nos',
        unitPrice: 0,
        discountPct: 0,
        taxPct: 18,
      },
    ]);
  };

  const removeLine = (id: string) => onChange(items.filter((l) => l.id !== id));
  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const colSpan = expandable ? 10 : 9;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
              {expandable && <th className="w-8 px-1 py-2.5"></th>}
              <th className="px-3 py-2.5 text-left">Item</th>
              <th className="px-3 py-2.5 text-left">HSN</th>
              <th className="px-2 py-2.5 text-right">Qty</th>
              <th className="px-2 py-2.5 text-left">Unit</th>
              <th className="px-2 py-2.5 text-right">Unit Price</th>
              <th className="px-2 py-2.5 text-right">Disc %</th>
              <th className="px-2 py-2.5 text-right">Tax %</th>
              <th className="px-3 py-2.5 text-right">Line Total</th>
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {items.map((line) => (
              <Fragment key={line.id}>
                <tr className="align-top">
                  {expandable && (
                    <td className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(line.id)}
                        className={classNames(
                          'rounded p-1 transition',
                          expanded[line.id] ? 'bg-brand-50 text-brand-600' : 'text-surface-400 hover:bg-surface-100 hover:text-surface-600'
                        )}
                        aria-label={expanded[line.id] ? 'Collapse details' : 'Expand details'}
                        title="Expand details"
                      >
                        {expanded[line.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-2 min-w-[220px]">
                    <select
                      value={line.itemId}
                      onChange={(e) => onSelectItem(line.id, e.target.value)}
                      className="input py-1.5"
                    >
                      <option value="">Select item…</option>
                      {catalog
                        .filter((c) => c.active || c.id === line.itemId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-surface-500">{line.hsnCode || '—'}</td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => update(line.id, { quantity: Math.max(0, Number(e.target.value)) })}
                      className="input w-16 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-2 py-2 text-surface-500">{line.unit || '—'}</td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      value={line.unitPrice}
                      onChange={(e) => update(line.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                      className="input w-24 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={line.discountPct}
                      onChange={(e) => update(line.id, { discountPct: Math.max(0, Number(e.target.value)) })}
                      className="input w-16 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={line.taxPct}
                      onChange={(e) => update(line.id, { taxPct: Math.max(0, Number(e.target.value)) })}
                      className="input w-16 py-1.5 text-right"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-surface-800">
                    {formatINR(lineTotal(line.quantity, line.unitPrice, line.discountPct))}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="rounded p-1.5 text-surface-400 hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {expandable && expanded[line.id] && (
                  <tr className="bg-surface-50/60">
                    <td colSpan={colSpan} className="px-3 py-3">
                      <ItemDetailPanel
                        line={line}
                        onPatch={(patch) => update(line.id, patch)}
                        defaultDeliveryDate={defaultDeliveryDate}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-surface-400">
                  No line items added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addLine} type="button">
        Add Line
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-item expandable detail: five collapsible groups. Technical / Documents /
// Accessories use reusable key→value rows so different products can carry
// different specification sets without schema changes.
// ---------------------------------------------------------------------------
function ItemDetailPanel({
  line,
  onPatch,
  defaultDeliveryDate,
}: {
  line: LineItem;
  onPatch: (patch: Partial<LineItem>) => void;
  defaultDeliveryDate?: string;
}) {
  const t = line.technical ?? {};
  const setTech = (patch: Partial<ItemTechnical>) => onPatch({ technical: { ...t, ...patch } });

  const schedule = line.schedule ?? [];
  const setSchedule = (rows: DeliveryScheduleRow[]) => onPatch({ schedule: rows });

  const addScheduleRow = () =>
    setSchedule([
      ...schedule,
      {
        id: `${line.id}-sch-${schedule.length + 1}`,
        scheduleNo: schedule.length + 1,
        deliveryDate: defaultDeliveryDate || undefined,
        expectedArrivalDate: defaultDeliveryDate || undefined,
        scheduledQty: 0,
        pendingQty: 0,
      },
    ]);
  const updateScheduleRow = (id: string, patch: Partial<DeliveryScheduleRow>) =>
    setSchedule(schedule.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeScheduleRow = (id: string) =>
    setSchedule(schedule.filter((r) => r.id !== id).map((r, i) => ({ ...r, scheduleNo: i + 1 })));

  return (
    <div className="space-y-2">
      <Group title="Product Details" defaultOpen>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniField label="Make" value={t.make ?? ''} onChange={(v) => setTech({ make: v })} placeholder="e.g. Endress+Hauser" />
          <MiniField label="Product" value={t.product ?? ''} onChange={(v) => setTech({ product: v })} placeholder="Product name" />
          <MiniField label="Model No" value={t.modelNo ?? ''} onChange={(v) => setTech({ modelNo: v })} placeholder="Model" />
          <MiniField label="Decodification No" value={t.decodificationNo ?? ''} onChange={(v) => setTech({ decodificationNo: v })} placeholder="Decodification" />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-surface-500">
          <span>Item Code: <b className="text-surface-700">{line.itemCode || '—'}</b></span>
          <span>HSN/SAC: <b className="text-surface-700">{line.hsnCode || '—'}</b></span>
          <span>GST%: <b className="text-surface-700">{line.taxPct}%</b></span>
          <span>UOM: <b className="text-surface-700">{line.unit || '—'}</b></span>
        </div>
      </Group>

      <Group title="Delivery Schedule">
        <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white">
          <table className="w-full min-w-[560px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                <th className="px-2 py-1.5 text-left">Sch.</th>
                <th className="px-2 py-1.5 text-left">Delivery Date</th>
                <th className="px-2 py-1.5 text-left">Expected Arrival</th>
                <th className="px-2 py-1.5 text-right">Scheduled Qty</th>
                <th className="px-2 py-1.5 text-right">Pending Qty</th>
                <th className="px-1 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {schedule.map((row) => (
                <tr key={row.id}>
                  <td className="px-2 py-1.5 text-surface-500">{row.scheduleNo}</td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={row.deliveryDate ?? ''} onChange={(e) => updateScheduleRow(row.id, { deliveryDate: e.target.value })} className="input py-1 text-[12px]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={row.expectedArrivalDate ?? ''} onChange={(e) => updateScheduleRow(row.id, { expectedArrivalDate: e.target.value })} className="input py-1 text-[12px]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min={0} value={row.scheduledQty} onChange={(e) => updateScheduleRow(row.id, { scheduledQty: Math.max(0, Number(e.target.value)) })} className="input w-20 py-1 text-right text-[12px]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min={0} value={row.pendingQty ?? 0} onChange={(e) => updateScheduleRow(row.id, { pendingQty: Math.max(0, Number(e.target.value)) })} className="input w-20 py-1 text-right text-[12px]" />
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" onClick={() => removeScheduleRow(row.id)} className="rounded p-1 text-surface-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Remove schedule row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {schedule.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-center text-[12px] text-surface-400">No schedule rows.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addScheduleRow} type="button" className="mt-2">
          Add Schedule Row
        </Button>
      </Group>

      <Group title="Documents Required">
        <KeyValueEditor
          rows={t.documents}
          onChange={(documents) => setTech({ documents })}
          labelPlaceholder="Document"
          valuePlaceholder="Detail"
          addLabel="Add Document"
        />
      </Group>

      <Group title="Technical Specifications">
        <KeyValueEditor
          rows={t.specs}
          onChange={(specs) => setTech({ specs })}
          labelPlaceholder="Specification"
          valuePlaceholder="Value"
          addLabel="Add Specification"
        />
      </Group>

      <Group title="Accessories & Other Details">
        <div className="space-y-3">
          <KeyValueEditor
            rows={t.accessories}
            onChange={(accessories) => setTech({ accessories })}
            labelPlaceholder="Accessory"
            valuePlaceholder="Detail"
            addLabel="Add Accessory"
          />
          <KeyValueEditor
            rows={t.otherDetails}
            onChange={(otherDetails) => setTech({ otherDetails })}
            labelPlaceholder="Other Detail"
            valuePlaceholder="Value"
            addLabel="Add Other Detail"
          />
        </div>
      </Group>
    </div>
  );
}

function Group({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-surface-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-surface-700 hover:bg-surface-50"
      >
        {open ? <ChevronDown className="h-4 w-4 text-surface-400" /> : <ChevronRight className="h-4 w-4 text-surface-400" />}
        <Sliders className="h-3.5 w-3.5 text-brand-500" />
        {title}
      </button>
      {open && <div className="border-t border-surface-100 px-3 py-3">{children}</div>}
    </div>
  );
}

function KeyValueEditor({
  rows,
  onChange,
  labelPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  rows?: SoKeyValue[];
  onChange: (rows: SoKeyValue[]) => void;
  labelPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  const list = rows ?? [];
  const update = (idx: number, patch: Partial<SoKeyValue>) =>
    onChange(list.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const remove = (idx: number) => onChange(list.filter((_, i) => i !== idx));
  const add = () => onChange([...list, { id: nextKvId(), label: '', value: '' }]);

  return (
    <div className="space-y-2">
      {list.map((row, idx) => (
        <div key={row.id ?? idx} className="flex items-center gap-2">
          <input
            value={row.label}
            onChange={(e) => update(idx, { label: e.target.value })}
            placeholder={labelPlaceholder}
            className="input w-2/5 py-1 text-[12px]"
          />
          <input
            value={row.value}
            onChange={(e) => update(idx, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className="input flex-1 py-1 text-[12px]"
          />
          <button type="button" onClick={() => remove(idx)} className="rounded p-1 text-surface-400 hover:bg-rose-50 hover:text-rose-500" aria-label="Remove row">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {list.length === 0 && <p className="text-[12px] text-surface-400">No rows yet.</p>}
      <Button variant="ghost" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={add} type="button">
        {addLabel}
      </Button>
    </div>
  );
}

function MiniField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-surface-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input py-1.5 text-[12px]" />
    </label>
  );
}
