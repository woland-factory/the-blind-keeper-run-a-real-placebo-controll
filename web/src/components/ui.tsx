import type { ReactNode } from "react";

export function Page({ children }: { children: ReactNode }) {
  return <main className="page">{children}</main>;
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
