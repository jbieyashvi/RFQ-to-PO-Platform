import { Plus, Trash2 } from 'lucide-react';
import type { Item, LineItem } from '@/types';
import { formatINR, lineTotal } from '@/lib/format';
import { Button } from './Button';

let lineSeq = 0;

export function ItemLineEditor({
  items,
  catalog,
  onChange,
}: {
  items: LineItem[];
  catalog: Item[];
  onChange: (lines: LineItem[]) => void;
}) {
  const update = (id: string, patch: Partial<LineItem>) => {
    onChange(items.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const onSelectItem = (id: string, itemId: string) => {
    const cat = catalog.find((c) => c.id === itemId);
    if (!cat) {
      update(id, { itemId: '', itemCode: '', description: '', hsnCode: '', unit: '', unitPrice: 0 });
      return;
    }
    update(id, {
      itemId: cat.id,
      itemCode: cat.code,
      description: cat.name,
      hsnCode: cat.hsnCode,
      unit: cat.unit,
      unitPrice: cat.unitPrice,
    });
  };

  const addLine = () => {
    onChange([
      ...items,
      {
        id: `newln-${++lineSeq}`,
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

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
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
              <tr key={line.id} className="align-top">
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
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-surface-400">
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
