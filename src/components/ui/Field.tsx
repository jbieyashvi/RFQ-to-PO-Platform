import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from 'react';
import { classNames } from '@/lib/format';

export function FieldWrap({
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-surface-400">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  wrapClassName?: string;
}
export function TextField({ label, error, hint, required, wrapClassName, className, ...rest }: TextProps) {
  return (
    <FieldWrap label={label} required={required} error={error} hint={hint} className={wrapClassName}>
      <input className={classNames('input', error && 'input-error', className)} {...rest} />
    </FieldWrap>
  );
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  wrapClassName?: string;
}
export function TextAreaField({ label, error, hint, required, wrapClassName, className, ...rest }: AreaProps) {
  return (
    <FieldWrap label={label} required={required} error={error} hint={hint} className={wrapClassName}>
      <textarea className={classNames('input', error && 'input-error', className)} {...rest} />
    </FieldWrap>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  wrapClassName?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}
export function SelectField({
  label,
  error,
  hint,
  required,
  wrapClassName,
  className,
  options,
  placeholder,
  ...rest
}: SelectProps) {
  return (
    <FieldWrap label={label} required={required} error={error} hint={hint} className={wrapClassName}>
      <select className={classNames('input pr-8 appearance-none bg-no-repeat', error && 'input-error', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.6rem center',
        }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2"
    >
      <span
        className={classNames(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-surface-300'
        )}
      >
        <span
          className={classNames(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </span>
      {label && <span className="text-sm text-surface-700">{label}</span>}
    </button>
  );
}
