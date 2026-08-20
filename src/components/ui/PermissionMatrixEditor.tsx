import { Fragment } from 'react';
import type { FeaturePermissions } from '@/types';
import { classNames } from '@/lib/format';
import {
  PERMISSION_GROUPS,
  FP_ACTIONS,
  FP_ACTION_LABELS,
  sectionHasAction,
  applyDependencies,
  cloneFeature,
  type FpAction,
  type GroupConfig,
} from '@/lib/featurePermissions';

// ---------------------------------------------------------------------------
// Employee Master permission matrix.
//
// Rows = modules / sub-sections (grouped), columns = the seven generic actions.
// A checkbox appears only where the action applies to that section. Enabling any
// action implies View for its section; clearing View clears the whole row
// (applyDependencies). Provides module-level (group) Select-all/Clear,
// action-column Select-all, and a global Clear-all.
// ---------------------------------------------------------------------------
export function PermissionMatrixEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: FeaturePermissions;
  onChange: (next: FeaturePermissions) => void;
  readOnly?: boolean;
}) {
  const commit = (fp: FeaturePermissions) => onChange(applyDependencies(fp));

  const setCell = (sectionKey: string, action: FpAction, next: boolean) => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    fp[sectionKey][action] = next;
    if (next && action !== 'view') fp[sectionKey].view = true;
    commit(fp);
  };

  const setColumn = (action: FpAction, next: boolean) => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    for (const s of PERMISSION_GROUPS.flatMap((g) => g.sections)) {
      if (!s.actions.includes(action)) continue;
      fp[s.key][action] = next;
      if (next && action !== 'view') fp[s.key].view = true;
    }
    commit(fp);
  };

  const setGroup = (group: GroupConfig, next: boolean) => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    for (const s of group.sections) for (const a of s.actions) fp[s.key][a] = next;
    commit(fp);
  };

  const clearAll = () => {
    if (readOnly) return;
    const fp = cloneFeature(value);
    for (const s of PERMISSION_GROUPS.flatMap((g) => g.sections)) for (const a of s.actions) fp[s.key][a] = false;
    commit(fp);
  };

  // Column "select all" reflects only the sections the action applies to.
  const columnState = (action: FpAction): 'all' | 'some' | 'none' => {
    const applicable = PERMISSION_GROUPS.flatMap((g) => g.sections).filter((s) => s.actions.includes(action));
    const on = applicable.filter((s) => value[s.key]?.[action]).length;
    if (on === 0) return 'none';
    if (on === applicable.length) return 'all';
    return 'some';
  };

  const groupState = (group: GroupConfig): 'all' | 'some' | 'none' => {
    let on = 0;
    let total = 0;
    for (const s of group.sections)
      for (const a of s.actions) {
        total += 1;
        if (value[s.key]?.[a]) on += 1;
      }
    if (on === 0) return 'none';
    if (on === total) return 'all';
    return 'some';
  };

  return (
    <div className="overflow-hidden rounded-xl border border-surface-200">
      {/* toolbar */}
      {!readOnly && (
        <div className="flex items-center justify-between gap-2 border-b border-surface-100 bg-surface-50/70 px-3 py-2">
          <span className="text-[12px] text-surface-500">
            Tick the actions this employee may perform. Enabling an action requires View for that row.
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="flex-none text-[12px] font-medium text-surface-500 hover:text-rose-600 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-surface-200 bg-white">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-[12px] font-semibold text-surface-600">
                Module
              </th>
              {FP_ACTIONS.map((action) => {
                const st = columnState(action);
                return (
                  <th key={action} className="px-2 py-2 text-center align-bottom">
                    <div className="flex flex-col items-center gap-1">
                      <span className="whitespace-nowrap text-[11px] font-semibold text-surface-600">
                        {FP_ACTION_LABELS[action]}
                      </span>
                      {!readOnly && (
                        <input
                          type="checkbox"
                          aria-label={`Select all ${FP_ACTION_LABELS[action]}`}
                          title={`Select all — ${FP_ACTION_LABELS[action]}`}
                          checked={st === 'all'}
                          ref={(el) => {
                            if (el) el.indeterminate = st === 'some';
                          }}
                          onChange={(e) => setColumn(action, e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40"
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => {
              const gs = groupState(group);
              return (
                <Fragment key={group.key}>
                  {/* group header row */}
                  <tr className="border-b border-surface-100 bg-surface-50/60">
                    <td className="sticky left-0 z-10 bg-surface-50/60 px-3 py-1.5" colSpan={1}>
                      <div className="flex items-center gap-2">
                        {!readOnly && (
                          <input
                            type="checkbox"
                            aria-label={`Select all in ${group.label}`}
                            title={`Select all — ${group.label}`}
                            checked={gs === 'all'}
                            ref={(el) => {
                              if (el) el.indeterminate = gs === 'some';
                            }}
                            onChange={(e) => setGroup(group, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40"
                          />
                        )}
                        <span className="text-[12px] font-bold uppercase tracking-wide text-surface-500">
                          {group.label}
                        </span>
                      </div>
                    </td>
                    <td colSpan={FP_ACTIONS.length} className="bg-surface-50/60" />
                  </tr>

                  {/* section rows */}
                  {group.sections.map((section) => (
                    <tr key={section.key} className="border-b border-surface-100 last:border-0 hover:bg-surface-50/40">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 pl-8 text-[13px] text-surface-700">
                        {section.label}
                      </td>
                      {FP_ACTIONS.map((action) => {
                        const applies = sectionHasAction(section.key, action);
                        if (!applies)
                          return (
                            <td key={action} className="px-2 py-2 text-center text-surface-200">
                              <span aria-hidden>–</span>
                            </td>
                          );
                        const checked = !!value[section.key]?.[action];
                        const locked = action !== 'view' && !value[section.key]?.view;
                        const disabled = readOnly || locked;
                        return (
                          <td key={action} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${section.label} — ${FP_ACTION_LABELS[action]}`}
                              title={locked ? 'Enable View first' : `${section.label} — ${FP_ACTION_LABELS[action]}`}
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => setCell(section.key, action, e.target.checked)}
                              className={classNames(
                                'h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40',
                                disabled && 'opacity-40'
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
