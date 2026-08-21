import { useMemo, useState } from 'react';
import { AlertTriangle, CircleAlert, Tag } from 'lucide-react';
import type { InboxEmail } from '@/types';
import type { RequirementItem } from '@/lib/requirementExtraction';
import type { Domain, FieldSpec } from '@/lib/requirementFields';
import {
  REQUIREMENT_SECTIONS,
  fieldLabel,
  fieldOptions,
  missingKeysOf,
  validateFields,
} from '@/lib/requirementFields';
import { Button, Drawer, SectionCard, StatusBadge } from '@/components/ui';
import { classNames } from '@/lib/format';
import { useApp } from '@/context/AppContext';

/**
 * Single Line-item Detail — the datasheet behind one extracted enquiry line.
 *
 * Opens as a wide overlay ON TOP of the Global Inbox rather than as its own
 * route: the sales engineer is still working the mail, and filling a gap in a
 * datasheet should not cost them the conversation they were reading.
 *
 * Everything the AI read is editable, including what it never read at all. The
 * two failure modes are kept visually distinct because they are chased
 * differently: a field the enquiry never stated is amber (ask the customer), a
 * stated value that cannot be true is rose (the enquiry contradicts itself).
 * Nothing is committed until Save Changes / Confirm Item, so a half-typed
 * datasheet never moves the card behind the drawer.
 */

export function RequirementDetailDrawer({
  email,
  item,
  onClose,
}: {
  email: InboxEmail;
  item: RequirementItem;
  onClose: () => void;
}) {
  const { updateEmail, addToast } = useApp();

  // The datasheet as it stood when the drawer opened (or was last saved) — what
  // "unsaved changes" is measured against.
  const [baseline, setBaseline] = useState<Record<string, string>>(item.fields);
  const [draft, setDraft] = useState<Record<string, string>>(item.fields);

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  // Validated live, so a corrected value stops being red as it is typed rather
  // than only once it is saved.
  const invalid = useMemo(() => validateFields(draft, item.domain), [draft, item.domain]);
  const missingKeys = useMemo(() => new Set(missingKeysOf(draft, item.domain)), [draft, item.domain]);
  const invalidCount = Object.keys(invalid).length;

  const dirty = useMemo(
    () => Object.keys({ ...baseline, ...draft }).some((k) => (baseline[k] ?? '') !== (draft[k] ?? '')),
    [baseline, draft]
  );

  const persist = (confirm: boolean) => {
    const edits = { ...(email.requirementEdits ?? {}), [item.id]: draft };
    const confirmed = new Set(email.requirementConfirmed ?? []);
    if (confirm) confirmed.add(item.id);
    updateEmail(email.id, { requirementEdits: edits, requirementConfirmed: Array.from(confirmed) });
    setBaseline(draft);
  };

  const onSave = () => {
    persist(false);
    addToast({
      type: 'success',
      title: `Line ${item.lineNo} saved`,
      message: missingKeys.size
        ? `${missingKeys.size} required ${missingKeys.size === 1 ? 'field is' : 'fields are'} still unstated.`
        : 'Every field this line needs is now stated.',
    });
  };

  const onConfirm = () => {
    persist(true);
    addToast({
      type: 'success',
      title: `Line ${item.lineNo} confirmed`,
      message: missingKeys.size
        ? `${item.tag} — confirmed with ${missingKeys.size} required ${missingKeys.size === 1 ? 'field' : 'fields'} still to chase.`
        : `${item.tag} — ${item.name} is ready to quote.`,
    });
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="2xl"
      title={
        <span className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold tabular-nums text-surface-400">Line {item.lineNo}</span>
          <span className="truncate">{item.name}</span>
        </span>
      }
      subtitle={<DrawerSubtitle item={item} missing={missingKeys.size} invalid={invalidCount} />}
      headerExtra={<StatusBadge tone={item.status === 'error' ? 'red' : item.status === 'confirmed' ? 'green' : 'amber'} label={item.status === 'error' ? 'Error' : item.status === 'confirmed' ? 'Confirmed' : 'Needs Review'} />}
      footer={
        <>
          <span className="mr-auto text-[11px] text-surface-500">
            {invalidCount > 0
              ? `${invalidCount} ${invalidCount === 1 ? 'value cannot' : 'values cannot'} be right — fix before confirming`
              : missingKeys.size > 0
              ? `${missingKeys.size} required ${missingKeys.size === 1 ? 'field' : 'fields'} still unstated`
              : dirty
              ? 'Unsaved changes'
              : 'Datasheet complete'}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={onSave} disabled={!dirty}>
            Save Changes
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={invalidCount > 0}>
            Confirm Item
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {item.errorNote && (
          <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <CircleAlert className="mt-px h-4 w-4 flex-none" />
            <span>{item.errorNote}</span>
          </p>
        )}

        {REQUIREMENT_SECTIONS.map((section) => {
          const grouped = section.fields.filter((f) => f.group);
          const plain = section.fields.filter((f) => !f.group);
          const groupName = grouped[0]?.group;
          return (
            <SectionCard key={section.id} title={section.title} description={section.description}>
              <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                {plain.map((spec) => (
                  <DatasheetField
                    key={spec.key}
                    spec={spec}
                    domain={item.domain}
                    value={draft[spec.key] ?? ''}
                    unit={unitOf(spec, draft)}
                    missing={missingKeys.has(spec.key)}
                    error={invalid[spec.key]}
                    onChange={(v) => set(spec.key, v)}
                  />
                ))}
              </div>

              {grouped.length > 0 && (
                <div className="mt-3 rounded-xl border border-surface-200 bg-surface-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{groupName}</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2.5">
                    {grouped.map((spec) => (
                      <YesNo
                        key={spec.key}
                        label={fieldLabel(spec, item.domain)}
                        value={draft[spec.key] ?? ''}
                        error={invalid[spec.key]}
                        onChange={(v) => set(spec.key, v)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>
    </Drawer>
  );
}

function DrawerSubtitle({ item, missing, invalid }: { item: RequirementItem; missing: number; invalid: number }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex items-center gap-1 font-medium text-surface-700">
        <Tag className="h-3 w-3" />
        {item.tag}
      </span>
      <span aria-hidden>·</span>
      <span className="truncate">{item.instrumentType || 'Instrument type not stated'}</span>
      <span aria-hidden>·</span>
      <span>
        Confidence{' '}
        <span
          className={classNames(
            'font-semibold tabular-nums',
            item.confidence >= 80 ? 'text-emerald-700' : item.confidence >= 55 ? 'text-amber-700' : 'text-rose-700'
          )}
        >
          {item.confidence}%
        </span>
      </span>
      <span aria-hidden>·</span>
      <span className={missing ? 'font-semibold text-amber-700' : undefined}>
        {missing} missing {missing === 1 ? 'field' : 'fields'}
      </span>
      {invalid > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="font-semibold text-rose-700">
            {invalid} invalid {invalid === 1 ? 'value' : 'values'}
          </span>
        </>
      )}
    </span>
  );
}

/** The unit shown inside a control — fixed, or taken from the datasheet's own
 *  flow / pressure unit so the numbers read in the units the enquiry used. */
function unitOf(spec: FieldSpec, fields: Record<string, string>): string {
  if (spec.unit) return spec.unit;
  if (spec.unitFrom) return fields[spec.unitFrom] ?? '';
  return '';
}

function DatasheetField({
  spec,
  domain,
  value,
  unit,
  missing,
  error,
  onChange,
}: {
  spec: FieldSpec;
  domain: Domain;
  value: string;
  unit: string;
  missing: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  const label = fieldLabel(spec, domain);
  const tone = error
    ? 'border-rose-400 bg-rose-50/70 focus:border-rose-500 focus:ring-rose-500/20'
    : missing
    ? 'border-amber-300 bg-amber-50/70 focus:border-amber-500 focus:ring-amber-500/20'
    : '';

  // A standalone datasheet flag still reads as a flag, not as a text box.
  if (spec.kind === 'toggle') {
    return (
      <div className={classNames(spec.wide && 'sm:col-span-2 xl:col-span-3')}>
        <YesNo label={label} value={value} error={error} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className={classNames(spec.wide && 'sm:col-span-2 xl:col-span-3')}>
      <label className="flex items-center gap-1 text-[11px] font-medium leading-4 text-surface-500">
        <span className="truncate">{label}</span>
        {missing && <span className="flex-none text-[10px] font-semibold uppercase text-amber-600">Required</span>}
      </label>
      <div className="relative mt-1">
        {spec.kind === 'select' ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={classNames('input appearance-none pr-7', tone)}
          >
            <option value="">Not stated</option>
            {fieldOptions(spec, domain).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {/* An edited value the option list does not carry still has to show. */}
            {value && !fieldOptions(spec, domain).includes(value) && <option value={value}>{value}</option>}
          </select>
        ) : (
          <input
            type="text"
            inputMode={spec.kind === 'number' ? 'decimal' : undefined}
            value={value}
            placeholder={spec.placeholder ?? 'Not stated'}
            onChange={(e) => onChange(e.target.value)}
            className={classNames('input', tone, unit && 'pr-12')}
          />
        )}
        {unit && spec.kind !== 'select' && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-surface-400">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-rose-600">
          <AlertTriangle className="mt-px h-3 w-3 flex-none" />
          <span>{error}</span>
        </p>
      ) : missing ? (
        <p className="mt-1 text-[11px] text-amber-700">Not stated in the enquiry</p>
      ) : null}
    </div>
  );
}

/** A datasheet flag. Left unset when the enquiry never said either way, so
 *  "not stated" never silently reads as "no". */
function YesNo({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium leading-4 text-surface-500">{label}</p>
      <div
        className={classNames(
          'mt-1 inline-flex overflow-hidden rounded-lg border bg-white',
          error ? 'border-rose-400' : 'border-surface-200'
        )}
      >
        {(['yes', 'no'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(value === option ? '' : option)}
            className={classNames(
              'px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors',
              value !== option
                ? 'text-surface-500 hover:bg-surface-50'
                : // A flag that IS set is worth the eye; a plain "no" is not, and
                  // must not read as an error next to the genuinely red fields.
                  option === 'yes'
                ? 'bg-brand-600 text-white'
                : 'bg-surface-600 text-white'
            )}
          >
            {option}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 max-w-[220px] text-[11px] font-medium text-rose-600">{error}</p>}
      {!error && !value && <p className="mt-1 text-[11px] text-surface-400">Not stated</p>}
    </div>
  );
}
