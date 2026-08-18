import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FeaturePermissions } from '@/types';
import { classNames } from '@/lib/format';
import {
  PERMISSION_GROUPS,
  FP_ACTION_LABELS,
  applyDependencies,
  actionLock,
  groupCounts,
  cloneFeature,
  type GroupConfig,
} from '@/lib/featurePermissions';

// ---------------------------------------------------------------------------
// Grouped accordion editor for the granular FeaturePermissions model.
// Each group is a collapsible card; each sub-section shows only the actions
// relevant to it. Enforces the dependency rules (view-gating + cross-action)
// via applyDependencies so the edited state is always internally consistent.
// ---------------------------------------------------------------------------
export function PermissionGroups({
  value,
  onChange,
  readOnly = false,
}: {
  value: FeaturePermissions;
  onChange: (next: FeaturePermissions) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(PERMISSION_GROUPS.map((g) => [g.key, true]))
  );

  const toggleGroup = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const setAction = (sectionKey: string, action: string, next: boolean) => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    fp[sectionKey][action] = next;
    // Enabling any action implies View for that sub-section.
    if (next && action !== 'view') fp[sectionKey].view = true;
    onChange(applyDependencies(fp));
  };

  const setGroupAll = (group: GroupConfig, next: boolean) => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    for (const s of group.sections) {
      for (const a of s.actions) fp[s.key][a] = next;
    }
    onChange(applyDependencies(fp));
  };

  return (
    <div className="space-y-2.5">
      {PERMISSION_GROUPS.map((group) => {
        const isOpen = open[group.key] ?? true;
        const { on, total } = groupCounts(value, group);
        return (
          <div key={group.key} className="overflow-hidden rounded-xl border border-surface-200">
            {/* group header */}
            <div className="flex items-center gap-2 bg-surface-50/70 px-3 py-2.5">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded"
              >
                <ChevronRight
                  className={classNames(
                    'h-4 w-4 flex-none text-surface-400 transition-transform',
                    isOpen && 'rotate-90'
                  )}
                />
                <span className="truncate text-[13px] font-semibold text-surface-800">{group.label}</span>
                <span className="flex-none rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-500">
                  {on} of {total} enabled
                </span>
              </button>
              {!readOnly && (
                <div className="flex flex-none items-center gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => setGroupAll(group, true)}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-surface-300">|</span>
                  <button
                    type="button"
                    onClick={() => setGroupAll(group, false)}
                    className="font-medium text-surface-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* sections */}
            {isOpen && (
              <div className="divide-y divide-surface-100">
                {group.sections.map((section) => (
                  <div
                    key={section.key}
                    className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-4"
                  >
                    <p className="flex-none pt-0.5 text-[13px] font-medium text-surface-700 sm:w-52">
                      {section.label}
                    </p>
                    <div className="flex flex-1 flex-wrap gap-x-4 gap-y-2">
                      {section.actions.map((action) => {
                        const lock = actionLock(value, section.key, action);
                        const checked = !!value[section.key]?.[action];
                        const disabled = readOnly || lock.disabled;
                        return (
                          <label
                            key={action}
                            title={lock.disabled ? lock.reason : undefined}
                            className={classNames(
                              'inline-flex items-center gap-1.5',
                              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => setAction(section.key, action, e.target.checked)}
                              className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40 disabled:opacity-50"
                            />
                            <span className="text-[13px] text-surface-700">{FP_ACTION_LABELS[action]}</span>
                            {lock.disabled && lock.reason && (
                              <span className="text-[12px] text-surface-400">({lock.reason})</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
