import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FORMULARY_EXPORT_PATH,
  getFormulary,
  logout,
  type FormularyCard,
} from "../api.js";
import { ErrorState, LoadingCard, Page } from "../components/ui.js";
import { plural } from "../plural.js";

type Load =
  | { status: "loading" }
  | { status: "ready"; cards: FormularyCard[] }
  | { status: "error" };

/** A signed number so a drop reads as a drop. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** p to three decimals, or the small-number form. */
function formatStatP(p: number): string {
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

function effectTag(card: FormularyCard): string {
  const v = card.verdict;
  if (!v || v.effect_estimate === null) return "Too little data";
  return v.significant ? "Beat the blank" : "Matched the blank";
}

function guessTag(v: NonNullable<FormularyCard["verdict"]>): string {
  if (v.guess_days_scored === 0) return "All unsure";
  return v.guesses_beat_chance ? "You felt it" : "Near a coin flip";
}

function statLine(v: NonNullable<FormularyCard["verdict"]>): string[] {
  const parts: string[] = [];
  if (v.effect_estimate !== null && v.permutation_p_value !== null) {
    parts.push(`${signed(v.effect_estimate)} ${v.effect_units ?? ""}, ${formatStatP(v.permutation_p_value)}`.trim());
  }
  if (v.guess_days_scored > 0) {
    parts.push(`Guessed ${v.guess_days_correct} of ${plural(v.guess_days_scored, "day")}`);
  }
  if (v.adherence_pct !== null) {
    parts.push(`Adherence ${v.adherence_pct}%`);
  }
  return parts;
}

function FormularyItem({ card }: { card: FormularyCard }) {
  const to = card.status === "unblinded" ? `/experiments/${card.id}/verdict` : `/experiments/${card.id}`;
  const voided = card.status === "voided";
  const v = card.verdict;

  return (
    <li className="formulary-item">
      <Link className="card formulary-card" to={to}>
        <div className="formulary-head">
          <span className="formulary-title">{card.substance_name}</span>
          <span className="formulary-sub">{card.metric_name}</span>
        </div>

        {voided ? (
          <>
            <span className="badge badge-voided">Voided</span>
            <p className="formulary-voided">You broke the blind, so this run has no verdict.</p>
            {card.ended_on && <span className="fine-print">Voided {card.ended_on}</span>}
          </>
        ) : (
          <>
            <div className="formulary-tags">
              <span className="badge badge-soft">{effectTag(card)}</span>
              {v && <span className="badge badge-soft">{guessTag(v)}</span>}
            </div>
            {v &&
              statLine(v).map((part) => (
                <span key={part} className="formulary-stat">
                  {part}
                </span>
              ))}
            {card.ended_on && <span className="fine-print">Finished {card.ended_on}</span>}
          </>
        )}
      </Link>
    </li>
  );
}

export function Home({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchFormulary = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const view = await getFormulary();
      setLoad({ status: "ready", cards: view.cards });
    } catch {
      setLoad({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void fetchFormulary();
  }, [fetchFormulary]);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      onSignedOut();
    }
  }

  return (
    <>
      <header className="app-bar">
        <span className="brand">blind-keeper</span>
        <button className="btn btn-ghost" onClick={onSignOut} disabled={signingOut} aria-busy={signingOut}>
          Sign out
        </button>
      </header>
      <Page>
        <p className="greeting">Signed in as {email}</p>

        {load.status === "loading" && <LoadingCard />}

        {load.status === "error" && (
          <ErrorState
            title="We could not load your formulary."
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void fetchFormulary()}
          />
        )}

        {load.status === "ready" && load.cards.length === 0 && (
          <section className="card empty-state">
            <h1>Start your first blind test</h1>
            <p>
              You choose a supplement and a daily score. We keep the schedule secret so you stay blind. At
              the end you get a verdict.
            </p>
            <button className="btn btn-primary" onClick={() => navigate("/design")}>
              Design a test
            </button>
          </section>
        )}

        {load.status === "ready" && load.cards.length > 0 && (
          <>
            <h1>Your formulary</h1>
            <div className="formulary-actions">
              <button className="btn btn-primary" onClick={() => navigate("/design")}>
                Design a test
              </button>
              <a className="btn btn-ghost" href={FORMULARY_EXPORT_PATH}>
                Export
              </a>
            </div>
            <ul className="formulary-list">
              {load.cards.map((card) => (
                <FormularyItem key={card.id} card={card} />
              ))}
            </ul>
          </>
        )}
      </Page>
    </>
  );
}
