import type { ActionKey, ModuleKey, PermissionMatrix as PMatrix } from '@/types';
import { ACTION_LABELS, ACTION_ORDER, MODULE_LABELS, MODULE_ORDER } from '@/lib/labels';
import { classNames } from '@/lib/format';

export function PermissionMatrix({
  value,
  onChange,
  readOnly = false,
}: {
  value: PMatrix;
  onChange?: (next: PMatrix) => void;
  readOnly?: boolean;
}) {
  const toggle = (mod: ModuleKey, act: ActionKey) => {
    if (readOnly || !onChange) return;
    onChange({
      ...value,
      [mod]: { ...value[mod], [act]: !value[mod][act] },
    });
  };

  const toggleModule = (mod: ModuleKey, on: boolean) => {
    if (readOnly || !onChange) return;
    const row = {} as Record<ActionKey, boolean>;
    for (const a of ACTION_ORDER) row[a] = on;
    onChange({ ...value, [mod]: row });
  };

  const toggleAction = (act: ActionKey, on: boolean) => {
    if (readOnly || !onChange) return;
    const next = { ...value };
    for (const m of MODULE_ORDER) next[m] = { ...next[m], [act]: on };
    onChange(next);
  };

  const columnAll = (act: ActionKey) => MODULE_ORDER.every((m) => value[m][act]);
  const rowAll = (mod: ModuleKey) => ACTION_ORDER.every((a) => value[mod][a]);

  return (
    <div className="overflow-x-auto rounded-xl border border-surface-200">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">
              Module
            </th>
            {ACTION_ORDER.map((act) => (
              <th key={act} className="px-2 py-2.5 text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">
                  {ACTION_LABELS[act]}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggleAction(act, !columnAll(act))}
                    className="mt-0.5 text-[10px] font-medium text-brand-600 hover:underline"
                  >
                    {columnAll(act) ? 'clear' : 'all'}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {MODULE_ORDER.map((mod) => (
            <tr key={mod} className="hover:bg-surface-50/60">
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-surface-700">{MODULE_LABELS[mod]}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => toggleModule(mod, !rowAll(mod))}
                      className="text-[10px] font-medium text-brand-600 hover:underline"
                    >
                      {rowAll(mod) ? 'clear' : 'all'}
                    </button>
                  )}
                </div>
              </td>
              {ACTION_ORDER.map((act) => (
                <td key={act} className="px-2 py-2.5 text-center">
                  <Checkbox
                    checked={value[mod][act]}
                    onChange={() => toggle(mod, act)}
                    disabled={readOnly}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={classNames(
        'inline-flex h-5 w-5 items-center justify-center rounded-md border transition',
        checked
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-surface-300 bg-white hover:border-brand-400',
        disabled && 'cursor-not-allowed opacity-70'
      )}
    >
      {checked && (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
