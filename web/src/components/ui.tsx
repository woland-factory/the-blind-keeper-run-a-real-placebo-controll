import { useId, type ReactNode } from "react";

export function Page({ children }: { children: ReactNode }) {
  return <main className="page">{children}</main>;
}

/** A number stepper with large, keyboard-reachable controls. */
export function Stepper({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const labelId = useId();
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="stepper" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label}`}
        >
          −
        </button>
        <span className="stepper-value" aria-live="polite">
          {value}
          {suffix ? ` ${suffix}` : ""}
        </span>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`More ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

/** A segmented control: a labeled set of mutually exclusive choices. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<Option<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className="segmented-btn"
            aria-pressed={opt.value === value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Loading placeholder that holds the layout steady (no white flash). */
export function LoadingCard() {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line short" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}

/** Designed error state: says what to do next, in the product's voice. */
export function ErrorState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="card" role="alert">
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="btn" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
